import { ONE, TILE } from './fixed';

/**
 * Everything the car physics and the bumps are tuned by. Distances are in units, speeds in units
 * a tick (30 ticks a second), so 1 tile/s is about 137. The numbers are the ones a prototype
 * raced well on; the comments say what each one buys.
 */
export interface RaceConfig {
  /** Top speed on the road: 1.6 tiles/s, which makes a 21 s lap of the Ring. */
  topSpeed: number;
  /** Top speed on grass, 0.6 tiles/s: cutting a corner costs more than it saves. */
  grassSpeed: number;
  /** Reverse limit, 0.4 tiles/s. */
  reverseSpeed: number;
  /** Speed gained a tick with the gas down: top speed in about 73 ticks, 2.4 s. */
  accel: number;
  /** Speed lost a tick braking, while moving forward. */
  brake: number;
  /** Speed lost a tick with no key down. */
  drag: number;
  /** Extra speed lost a tick over the grass limit while on grass. */
  grassDrag: number;
  /** Most heading steps a tick the wheel turns, 52 of 4096: a full turn in about 2.6 s. */
  turnRate: number;
  /** The speed at which the wheel is at full effect, 0.5 tiles/s; below it the car barely steers. */
  turnSpeed: number;
  /** Percent of the steering lost at top speed, so a fast car cannot take a hairpin. */
  understeer: number;
  /** Distance from the centreline where the kerb ends and the grass begins. */
  road: number;
  /** Half the width of the corridor between the walls. */
  wall: number;
  /** Radius of each of the car's two circles: 0.065 tile. */
  radius: number;
  /** How far ahead of and behind the centre the circles sit: 0.085 tile. */
  reach: number;
  /** Cosine, scaled by `ONE`, above which a nose is said to point at the other car. */
  aim: number;
}

export const RACE: RaceConfig = {
  topSpeed: 218,
  grassSpeed: 82,
  reverseSpeed: 55,
  accel: 3,
  brake: 7,
  drag: 1,
  grassDrag: 5,
  turnRate: 52,
  turnSpeed: 68,
  understeer: 35,
  road: 1712,
  wall: TILE / 2,
  radius: 266,
  reach: 348,
  aim: Math.round(0.3 * ONE),
};
