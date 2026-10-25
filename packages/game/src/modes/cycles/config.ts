/** Everything here is counted in ticks or cells: the rules never see milliseconds. */
export interface CyclesConfig {
  /**
   * Field side per square root of the head count. Each participant gets k² cells whatever their
   * number, so four players and twenty find the field equally crowded.
   */
  sidePerRootPlayer: number;
  minSide: number;
  /** Trail length a bike starts every life with. */
  trail: number;
  /** The most a trail can grow to; also the ring buffer's capacity. */
  trailMax: number;
  /** Cells a trail gains for every rival that dies in it. */
  killBonus: number;
  /** Ticks a bike may stand against an obstacle before it dies. */
  rubber: number;
  /** Ticks of free movement that buy back one tick of rubber. */
  rubberRegenTicks: number;
  boostTicks: number;
  /** Counted from the moment a boost ends. */
  boostCooldownTicks: number;
  respawnTicks: number;
  /** Turns a player may queue ahead; one is spent per tick. */
  turnQueue: number;
  /** Cells a bot may flood-fill per option it weighs. */
  botBudget: number;
  /** A bot only thinks when an obstacle is closer than this. */
  botLookahead: number;
  /** Whether a bike always lays its wall or only while its player holds a key. */
  walls: WallMode;
  /** Energy a life starts with, in cells of wall; read in `button` mode only. */
  energyTicks: number;
  /** The most the capacity can grow to with kills. */
  energyMaxTicks: number;
  /** What a kill adds to both the capacity and the energy. */
  energyKillTicks: number;
  /** Ticks of riding without a wall that buy back one unit of energy. */
  energyRegenTicks: number;
}

/** Cells a second the host can choose; one cell per tick, so this is also the tick rate. */
export const SPEEDS = [8, 12, 16, 20] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 8;

export const WALL_MODES = ['always', 'button'] as const;
export type WallMode = (typeof WALL_MODES)[number];

/** The room's settings that only the light cycles read. */
export interface CyclesSettings {
  speed: Speed;
  walls: WallMode;
}
export const DEFAULT_CYCLES_SETTINGS: CyclesSettings = { speed: DEFAULT_SPEED, walls: 'always' };

/** Tuned for a 20 Hz tick: the spec's seconds are these ticks divided by twenty. */
export const CYCLES_CONFIG: CyclesConfig = {
  sidePerRootPlayer: 28.6,
  minSide: 40,
  trail: 200,
  trailMax: 400,
  killBonus: 25,
  rubber: 3,
  rubberRegenTicks: 20,
  boostTicks: 20,
  boostCooldownTicks: 80,
  respawnTicks: 40,
  turnQueue: 2,
  botBudget: 256,
  botLookahead: 8,
  walls: 'always',
  energyTicks: 80,
  energyMaxTicks: 160,
  energyKillTicks: 20,
  energyRegenTicks: 2,
};

/**
 * Durations are designed in seconds and converted to ticks for a speed, so a boost lasts one
 * second and a respawn two at any speed. Rubber stays a count of ticks: it forgives latency,
 * and a slower tick already forgives more.
 */
export function cyclesConfigFor({ speed, walls }: CyclesSettings): CyclesConfig {
  return {
    ...CYCLES_CONFIG,
    boostTicks: speed,
    boostCooldownTicks: speed * 4,
    respawnTicks: speed * 2,
    rubberRegenTicks: speed,
    walls,
    // Like the boost: four seconds to start, eight at most, a second per kill. The regeneration
    // rate is a ratio of ticks, so it does not move with the speed.
    energyTicks: speed * 4,
    energyMaxTicks: speed * 8,
    energyKillTicks: speed,
  };
}
