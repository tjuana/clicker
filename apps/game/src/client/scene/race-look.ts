import { NeutralToneMapping, type ToneMapping } from 'three';

/**
 * Every brightness, size and texture figure of the ring race's scene lives here, so the owner's
 * correction by eye is a one-line change. All were tried in the visual prototype (design §8).
 */

/** Where the Kit's models and the Poly Haven textures are served from. */
export const ASSETS = '/race';
export const SKY = `${ASSETS}/kloofendal_48d_partly_cloudy_puresky_1k.hdr`;

/**
 * ACES crushes the Kit's saturated red and green towards orange and yellow; Neutral keeps hues and
 * only rolls off the highlights (Real-Time Rendering study, P4). The owner has seen both.
 */
export const TONE_MAPPING: ToneMapping = NeutralToneMapping;

/** Canvas pixel ratio range: the owner's machine lagged with a fixed 2x, so it may fall back to 1. */
export const PIXEL_RATIO: [number, number] = [1, 2];

/** How many times a texture repeats over one tile, per material: the tiles' own UVs are palette coordinates. */
export const REPEAT = { road: 3, grass: 2, kerb: 2 };
export const ROAD_ROUGHNESS = 0.85;
/** Kerb stones are the Kit's near-white; a touch under 1 so the sun does not clip them. */
export const KERB_COLOUR = '#e8e8e8';
export const KERB_ROUGHNESS = 0.7;

/** The ground reaches past the horizon haze of the camera; textured like the tiles' own grass. */
export const GROUND_SIZE = 200;
/** Grass repeats per unit of ground: same density as the tiles' (REPEAT.grass). */
export const GROUND_REPEAT = REPEAT.grass;
/** Below the tiles' surface, or it z-fights with their grass. */
export const GROUND_Y = -0.003;
/** The grass is a little darker and cooler than the texture: untinted, the tiles' verge read tan against the ground. */
export const GRASS_TINT = '#9ab88a';

/** Lifts the tiles off the ground plane: the Kit's root node sits 0.01 low. */
export const TILE_LIFT = 0.01;

/** Barriers: red and white blocks, in tile units. */
export const BARRIER = {
  /** How far from the centreline: just outside the wall at 0.5 so the car's contact reads as touching. */
  lateral: 0.52,
  height: 0.12,
  thickness: 0.06,
  /** Blocks per tile of centreline, at least two a piece. */
  perTile: 4,
  /** Share of its slot a block fills on a straight: blocks that overlap z-fight and flicker. */
  straightShare: 0.985,
  /** On a curve straight blocks meet at an angle, so their inner corners need more room. */
  curveShare: 0.9,
  /** Inner arcs of the small corner shrink to nothing; below this radius no block is laid. */
  minRadius: 0.05,
  /** Two thicknesses: where two walls meet at a right angle (the inside of a small corner) their squares would cross. */
  cornerGap: 0.12,
  red: '#d33a3a',
  white: '#f2f2f2',
  roughness: 0.6,
};

/** Light. The sky does the filling, the sun draws the shadows. */
export const ENVIRONMENT_INTENSITY = 0.8;
export const SUN = {
  intensity: 2.2,
  /** Direction from the track's centre towards the sun, in tiles; only the direction matters. */
  from: [10, 14, 6] as [number, number, number],
  /** Filtered shadows (PCF; three 0.186 has dropped the separate soft mode); 2048 over the track is about 0.007 tile a texel. */
  mapSize: 2048,
  bias: -0.0005,
  /** Extra tiles around the track's bounds that the shadow camera covers. */
  margin: 1,
};

/** The view until the race's first message: above and behind, looking down. */
export const OVERVIEW = {
  fov: 60,
  near: 0.02,
  far: 400,
  /** Where the camera stands relative to the track's centre. */
  offset: [0, 7, 7.5] as [number, number, number],
};

/**
 * The cars. Their colours are the light cycles' slot palette (`slots.ts`): twelve hues far apart,
 * wrapping past twelve, and tried against the Kit's body red, white-multiplied, they read on
 * asphalt and on grass.
 */
export const CAR = {
  /** Nose to tail in tiles; a lane is 0.69 wide, so a car takes under half of it. */
  length: 0.3,
  /**
   * The Kit's car is 0.162 tile wide but collides as two circles 0.13 wide: drawn at full width it
   * sinks 0.026 into a barrier and overlaps a neighbour by 0.032. Only the width shrinks; the
   * length already matches the collision.
   */
  widthScale: 0.85,
  /** The Kit names the body material `red`; it is made white so the slot colour is what shows. */
  bodyMaterial: 'red',
  /** Instances per mesh: the room seats twenty and a slot beyond this is not drawn. */
  capacity: 20,
};

/**
 * The chase camera, in tiles. It eases towards its place behind the car instead of sitting on
 * it: a camera nailed to the car shakes the whole picture with every correction the car makes.
 */
export const CHASE = {
  behind: 1.1,
  above: 0.45,
  /** How far ahead of the car, and how high, the camera looks. */
  ahead: 0.8,
  lookHeight: 0.05,
  /** Per second; the share of the gap closed each frame is `1 - exp(-ease * dt)`. */
  ease: 6,
  /** A stalled tab's first frame back must not throw the camera across the track. */
  maxDt: 0.05,
};
