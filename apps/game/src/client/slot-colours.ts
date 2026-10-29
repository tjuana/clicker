import { SLOT_HEX } from './slots';

// Plain .ts, not in a HUD component file: the test project has no JSX setting, so a test could
// not import them from a .tsx.

/** The colour of a bike, the one the scene paints it in. Arena slots count from one. */
export const slotColour = (slot: number): string =>
  SLOT_HEX[(slot - 1) % SLOT_HEX.length] as string;

/** The colour of a car, the one the scene paints it in. Race slots count from zero. */
export const raceColour = (slot: number): string => SLOT_HEX[slot % SLOT_HEX.length] as string;
