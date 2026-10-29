/**
 * The twelve slot colours, as sRGB hexes. They live outside the scene because the HUD names a
 * player in the same colour, and importing `scene/look` there would pull three into the HUD's
 * bundle. Each hue sits at its most saturated sRGB point (OKLCH cusp, lightness floored at 0.62);
 * the closest pair is ΔE 9.4 in OKLab, held by test/slot-palette.test.ts. Slots past twelve repeat.
 */
export const SLOT_HEX = [
  '#fe052c',
  '#fe7802',
  '#fdca0e',
  '#c2fd0a',
  '#0dfd78',
  '#12fcdf',
  '#0fe3fe',
  '#04acfb',
  '#5977ff',
  '#a052fe',
  '#f007ff',
  '#ff05a9',
];

/** The colour of a bike, the one the scene paints it in. Arena slots count from one. */
export const slotColour = (slot: number): string =>
  SLOT_HEX[(slot - 1) % SLOT_HEX.length] as string;

/** The colour of a car, the one the scene paints it in. Race slots count from zero. */
export const raceColour = (slot: number): string => SLOT_HEX[slot % SLOT_HEX.length] as string;
