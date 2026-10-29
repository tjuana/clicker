import { Color } from 'three';

/**
 * Every brightness and shape number of the scene lives here, so the owner's correction by eye is a
 * one-line change. Bloom keys on luminance (three's high-pass: linear Rec. 709 weights), which is why levels go past 1 on purpose.
 */

/** One neon colour per slot, as far apart in hue as twenty can be. */
export const SLOT_COLOURS = [
  '#ffe066',
  '#00f0ff',
  '#ff3df2',
  '#7dff6a',
  '#ff8a3d',
  '#8a7dff',
  '#ff4d6d',
  '#3dffb5',
  '#ffd23d',
  '#3da5ff',
  '#d63dff',
  '#b5ff3d',
  '#ff6a3d',
  '#3dfff0',
  '#ff3d9e',
  '#9eff3d',
  '#3d6aff',
  '#ffb53d',
  '#3dff6a',
  '#f03dff',
].map((hex) => new Color(hex));

/** A wall is dark and solid, below the bloom threshold; translucent ones stripe where they overlap. */
export const WALL_LEVEL = 0.3;
/** Past the bloom threshold, so the bikes glow while the walls do not. */
export const BIKE_LEVEL = 1.25;
/**
 * A bike that is not laying its wall: dark enough not to glow, bright enough to still be seen. The
 * brightest the surface makes any fragment is CYCLE_SURFACE_MAX (the brightest of a rim, a seam and
 * the stripe at 1, plus the Fresnel rim's 0.25, so 1.25); times the luminance of the brightest
 * slot colour (0.817) times 0.45 comes to 0.459, below BLOOM.threshold 0.6, so an unlit bike gives
 * no bloom at all. test/cycle-bloom.test.ts holds it for every slot colour.
 */
export const DIM_LEVEL = 0.45;

/**
 * The bikes' surface is procedural (RTR 6.3): its levels are multiplied by the slot's colour and
 * BIKE_LEVEL or DIM_LEVEL, and bloom keys on the product's luminance against BLOOM.threshold. Lengths
 * below are in the model's own units, the bike drawn at its 1.6 size, 2.2 long and 0.9 tall.
 *
 * Known, and the owner's call: luminance is not the brightest channel, so a lit bike's rims and
 * stripe (level 1 x BIKE_LEVEL 1.25) bloom for only 10 of the 20 slot colours, its seams (0.7) for
 * 8 of 20; the blues and magentas (#3d6aff, #d63dff, #ff3df2) stay under the threshold. This
 * predates the procedural surface: the rims were 1 x 1.25 before it too. A body never blooms.
 */
/** The rims: the part of the bike that is a lit outline. */
export const CYCLE_GLOW = 1;
/** The body and nose between the lines: lit 0.4, under the threshold for every slot colour, so it stays a dark mass. */
export const CYCLE_BODY = 0.32;
/** Discs and canopy: nearly black, so the rims read as rings. */
export const CYCLE_DARK = 0.16;
/** The panel seams on the body: lit 0.875 x luminance, so a few fine lines glow on the brighter colours (8 of 20); dim never. */
export const CYCLE_SEAM = 0.7;
/** The flank stripe: as bright as the rims, it is the bike's signature when seen side-on. */
export const CYCLE_STRIPE = 1;
/** Fresnel rim (RTR 9.5), added to the level: a body's grazing edge goes 0.32 to 0.57, lit 0.71: under the threshold even for the brightest slot (0.582), so it is a brighter edge, not a bloom. */
export const CYCLE_RIM = 0.25;
/** As the walls' RIM_EXPONENT: high keeps the glow to the silhouette and off the flat of the flank. */
export const CYCLE_RIM_EXPONENT = 3.0;
/** Distance between two seams along the body: five or six panels on a 1.5 long body. */
export const SEAM_SPACING = 0.3;
/** A seam's full width: about a pixel on the player's own bike at the chase camera, so it is a line, not a band. */
export const SEAM_WIDTH = 0.02;
/** Height of the stripe's centre: where the old stripe box sat, a little above the body's middle. */
export const STRIPE_Y = 0.69;
/** Half the stripe's height: 0.06 in all, thin enough to read as a light strip and not a painted band. */
export const STRIPE_HALF = 0.03;
/**
 * The brightest level the surface can give any fragment, which the dim bike's no-bloom guarantee is
 * built on: a seam or the stripe replaces the body's level (never adds to it), the rim adds.
 */
export const CYCLE_SURFACE_MAX = Math.max(CYCLE_GLOW, CYCLE_SEAM, CYCLE_STRIPE) + CYCLE_RIM;

/** The wall's top band is this much brighter than its body: the edge that blooms. */
export const TOP = 4.0;
/** The band spans this fraction of the wall's height... */
export const TOP_FROM = 0.86;
/** ...up to this one; the smoothstep between them keeps the edge soft. */
export const TOP_TO = 0.96;
/** The body's brightness at the foot, so a wall fades into the floor; it reaches 1 at the top. */
export const FOOT = 0.35;
/** How much a wall seen edge-on glows over one seen face-on: a rim that outlines the trail. */
export const RIM = 0.5;
/** How fast the rim falls off towards the face-on side: higher keeps the glow on the outline only. */
export const RIM_EXPONENT = 3.0;
/** How narrow the pulse's crest is: higher is a thinner bright band between long dark stretches. */
export const PULSE_EXPONENT = 12.0;
/** The field's border walls: a cooler, dimmer cyan than any bike, so the edge reads but never competes. */
export const BORDER_COLOUR = '#0f8fb0';
/** How much brighter the moving crest is than the body. */
export const PULSE = 0.9;
/** Seconds between two crests of the pulse running along a trail. */
export const PULSE_PERIOD_S = 3;

/** The owner's, by eye. */
export const BLOOM = { strength: 0.55, radius: 0.35, threshold: 0.6 };

/**
 * The floor's mirror. All figures were tried by eye in a scratch scene with 20 bikes:
 * a sharper reflection read as a second, wrong arena under the real one.
 */
export const FLOOR = {
  /** The mirror's and both blur targets' size as a fraction of the canvas (CSS px), aspect kept: soft smears need no more, and it is a second render of the arena every frame. */
  fraction: 0.25,
  /** Gaussian sigma across the view, in texels of the target: small, so a bike stays a narrow streak and not a blob. */
  sigmaAcross: 1.5,
  /** Gaussian sigma down the view, in texels: large, the microfacet stretch of RTR 9.8 that makes wet asphalt streak vertically. */
  sigmaDown: 8,
  /** How much of the reflection shows; 6 doubled the glow of every wall and flooded the frame. */
  strength: 2.3,
};

/** The grid's colour level: 1 was brighter than the reflections it sits on and read as a net over them. */
export const GRID_LEVEL = 0.75;
/** The grid's base colour, before the level. */
export const GRID_COLOUR = '#0a5a7a';
/** Cells between two grid lines: every cell was noise at a distance. */
export const GRID_SPACING = 2;
