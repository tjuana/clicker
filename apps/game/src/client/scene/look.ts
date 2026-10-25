import { Color } from 'three';

/**
 * Every brightness and shape number of the scene lives here, so the owner's correction by eye is a
 * one-line change. Bloom keys on brightness, which is why levels go past 1 on purpose.
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
  /** Reflection texture size: soft smears need no more, and it is rendered a second time every frame. */
  resolution: 512,
  /** How far the reflection is smeared; high on purpose, the floor is wet asphalt, not a mirror. */
  blur: [250, 250] as [number, number],
  /** How much of the reflection shows; 6 doubled the glow of every wall and flooded the frame. */
  mixStrength: 3,
};

/** The grid's colour level: 1 was brighter than the reflections it sits on and read as a net over them. */
export const GRID_LEVEL = 0.75;
/** The grid's base colour, before the level. */
export const GRID_COLOUR = '#0a5a7a';
/** Cells between two grid lines: every cell was noise at a distance. */
export const GRID_SPACING = 2;
