import { Color, ColorManagement, Vector3 } from 'three';
import { SLOT_HEX } from '../slots';

/**
 * Every brightness and shape number of the scene lives here, so the owner's correction by eye is a
 * one-line change. Bloom keys on luminance (three's high-pass: linear Rec. 709 weights), which is why levels go past 1 on purpose.
 */

/** The slot colours as they are, which is what the race's car bodies wear: paint, not light. */
export const SLOT_COLOURS = SLOT_HEX.map((hex) => new Color(hex));

/**
 * The luminance every glowing thing takes from its slot colour. Bloom keys on luminance, and the
 * palette's own run from 0.21 (violet #a052fe) to 0.82 (lime #c2fd0a) made a lime bike blaze and a
 * violet one look switched off. 0.6 is chosen for what it does to the levels below: a lit rim at
 * 1 x BIKE_LEVEL 1.25 comes to 0.75, over BLOOM.threshold 0.6 with margin, while seams (0.525),
 * bodies and walls stay under it. The gain on the colour is x0.73 to x2.90 (x0.92 to x3.62 with
 * BIKE_LEVEL in); lifting the dark hues in the colour itself washed the blues to pastel and
 * brought the closest pair to dE 5.6 (plan 19).
 */
export const SLOT_LUMINANCE = 0.6;

const WEIGHTS = ColorManagement.getLuminanceCoefficients(new Vector3());

/**
 * Each slot colour scaled to SLOT_LUMINANCE, with the very coefficients three's bloom uses on the
 * linear working-space colour: bikes and walls are built from these, so every rider is as bright
 * as every other and the levels below mean the same thing for all of them.
 */
export const SLOT_GLOW = SLOT_COLOURS.map((c) =>
  c.clone().multiplyScalar(SLOT_LUMINANCE / (c.r * WEIGHTS.x + c.g * WEIGHTS.y + c.b * WEIGHTS.z)),
);

/** A wall is dark and solid, below the bloom threshold; translucent ones stripe where they overlap. */
export const WALL_LEVEL = 0.3;
/** Past the bloom threshold, so the bikes glow while the walls do not. */
export const BIKE_LEVEL = 1.25;
/**
 * A bike that is not laying its wall: dark enough not to glow, bright enough to still be seen. The
 * brightest the surface makes any fragment is CYCLE_SURFACE_MAX (the brightest of a rim, a seam and
 * the stripe at 1, plus the Fresnel rim's 0.25, so 1.25); times SLOT_LUMINANCE 0.6 times 0.45 comes
 * to 0.3375, below BLOOM.threshold 0.6, so an unlit bike gives no bloom at all.
 * test/cycle-bloom.test.ts holds it for every slot.
 */
export const DIM_LEVEL = 0.45;

/**
 * What is actually drawn: each slot's glow at the level of its part. Here and not beside the
 * meshes so test/cycle-bloom.test.ts reads the very colours the bikes and walls are painted in.
 */
export const BIKE_COLOURS = SLOT_GLOW.map((c) => c.clone().multiplyScalar(BIKE_LEVEL));
export const DIM_COLOURS = SLOT_GLOW.map((c) => c.clone().multiplyScalar(DIM_LEVEL));
export const WALL_COLOURS = SLOT_GLOW.map((c) => c.clone().multiplyScalar(WALL_LEVEL));

/**
 * The colour a table gives an arena slot (they count from one), wrapping past the palette. One
 * function for bikes and walls, so both agree with the HUD's slotColour (slots.ts).
 */
export const glowFor = (table: readonly Color[], slot: number): Color =>
  table[(slot - 1) % table.length] as Color;

/**
 * The bikes' surface is procedural (RTR 6.3): its levels are multiplied by the slot's colour and
 * BIKE_LEVEL or DIM_LEVEL, and bloom keys on the product's luminance against BLOOM.threshold. Lengths
 * below are in the model's own units, the bike drawn at its 1.6 size, 2.2 long and 0.9 tall.
 *
 * Every slot glows at SLOT_LUMINANCE, so one set of numbers serves all of them: a lit bike's rims
 * and stripe (level 1 x BIKE_LEVEL 1.25 x 0.6 = 0.75) bloom for every slot, its seams (0.7, so
 * 0.525) for none. A body never blooms.
 */
/** The rims: the part of the bike that is a lit outline. */
export const CYCLE_GLOW = 1;
/** The body and nose between the lines: lit 0.24, under the threshold, so it stays a dark mass. */
export const CYCLE_BODY = 0.32;
/** Discs and canopy: nearly black, so the rims read as rings. */
export const CYCLE_DARK = 0.16;
/** The panel seams on the body: lit 0.525: under the threshold for every slot, so the seams are fine lines and never bloom, lit or dim. */
export const CYCLE_SEAM = 0.7;
/** The flank stripe: as bright as the rims, it is the bike's signature when seen side-on. */
export const CYCLE_STRIPE = 1;
/** Fresnel rim (RTR 9.5), added to the level: a body's grazing edge goes 0.32 to 0.57, lit 0.43: under the threshold for every slot, so it is a brighter edge, not a bloom. */
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
