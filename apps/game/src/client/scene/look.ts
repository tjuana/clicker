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
/** How much brighter the moving crest is than the body. */
export const PULSE = 0.9;
/** Seconds between two crests of the pulse running along a trail. */
export const PULSE_PERIOD_S = 3;

/** The owner's, by eye. */
export const BLOOM = { strength: 0.55, radius: 0.35, threshold: 0.6 };
