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
}

/** Cells a second the host can choose; one cell per tick, so this is also the tick rate. */
export const SPEEDS = [8, 12, 16, 20] as const;
export type Speed = (typeof SPEEDS)[number];
export const DEFAULT_SPEED: Speed = 8;

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
};

/**
 * Durations are designed in seconds and converted to ticks for a speed, so a boost lasts one
 * second and a respawn two at any speed. Rubber stays a count of ticks: it forgives latency,
 * and a slower tick already forgives more.
 */
export function cyclesConfigFor(speed: Speed): CyclesConfig {
  return {
    ...CYCLES_CONFIG,
    boostTicks: speed,
    boostCooldownTicks: speed * 4,
    respawnTicks: speed * 2,
    rubberRegenTicks: speed,
  };
}
