import { ONE, TILE } from './fixed';

/**
 * Everything the car physics and the bumps are tuned by. Distances are in units, speeds in units
 * a tick (30 ticks a second), so 1 tile/s is about 137. The numbers are the ones a prototype
 * raced well on; the comments say what each one buys.
 */
/** What a bot is tuned by; the numbers are those a prototype raced twenty bots well on. */
export interface BotConfig {
  /** The lane of slot 0, 1 and 2 is minus, zero and plus this: 0.17 tile. 0.12 overlapped. */
  lane: number;
  /** The aim point is this far ahead at rest, 0.45 tile... */
  lookBase: number;
  /** ...and this much farther at top speed, 0.8 tile. */
  lookSpeed: number;
  /** A cross product smaller than this steers nothing: 0.02 tile. */
  deadZone: number;
  /** Speed to hold through a corner of size 1, 2 and 3: 0.95, 1.35 and 1.6 tiles/s. */
  cornerSpeed: [number, number, number];
  /** Distance kept beyond the braking distance before a corner: 0.3 tile. */
  slack: number;
  /** How much farther than the braking distance a bot looks for corners: 0.6 tile. */
  horizon: number;
  /** A car ahead closer than this, 0.5 tile, in the bot's lane makes it swerve... */
  blockGap: number;
  /** ...if its lateral place is within 0.15 tile of the lane. */
  blockWidth: number;
  /** A swerve moves the lane 0.2 tile away from the blocker, but never past 0.22 from the centre. */
  swerve: number;
  swerveMax: number;
  /** The swerve is refused when a car within 0.35 tile along is within 0.14 tile of its lane. */
  freeGap: number;
  freeWidth: number;
}

export interface RaceConfig {
  bot: BotConfig;
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
  /** Laps to complete: the start line is crossed once to begin the first and once to end each. */
  laps: number;
  /** Percent of top speed a finished car cruises at, on autopilot, so that it is not a roadblock. */
  coolPace: number;
  /** Ticks the race goes on after the first car finishes: 30 s. */
  afterFirst: number;
  /** Ticks after which a race ends whatever happens: 5 minutes. */
  cap: number;
  /** Lateral offset of the two grid columns, 0.15 tile either side of the centreline. */
  gridLateral: number;
  /** Distance from the start line to the first row, a quarter tile. */
  gridFront: number;
  /** Distance between rows: 0.4 tile, a car length and a gap. */
  gridRow: number;
}

export const RACE: RaceConfig = {
  bot: {
    lane: 696,
    lookBase: 1843,
    lookSpeed: 3277,
    deadZone: 82,
    cornerSpeed: [130, 184, 218],
    slack: 1229,
    horizon: 2458,
    blockGap: 2048,
    blockWidth: 614,
    swerve: 819,
    swerveMax: 901,
    freeGap: 1434,
    freeWidth: 573,
  },
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
  laps: 3,
  coolPace: 50,
  afterFirst: 30 * 30,
  cap: 5 * 60 * 30,
  gridLateral: 614,
  gridFront: 1024,
  gridRow: 1638,
};
