/**
 * Directions, clockwise with y growing downwards: east, south, west, north. Turning is a step
 * around the compass, `(dir + 1) & 3` to the right and `(dir + 3) & 3` to the left.
 */
export const DX = [1, 0, -1, 0] as const;
export const DY = [0, 1, 0, -1] as const;

export type Turn = 'left' | 'right';

export type CyclesInput =
  | { type: 'turn'; side: Turn }
  | { type: 'boost' }
  | { type: 'wall'; on: boolean };

/**
 * A trail is a ring buffer over a fixed `Int32Array` of `trailMax` cells. The capacity never
 * changes: growing a trail after a kill only raises `cap`, so a cell keeps its index for its
 * whole life — which is what lets the client map trail cells to instances one to one.
 */
export interface Trail {
  cells: Int32Array;
  /** Index of the oldest cell. */
  start: number;
  size: number;
}

export interface Bike {
  /** 1…n. Written into the field, so it must stay small; never reused within a round. */
  slot: number;
  publicId: string;
  bot: boolean;
  alive: boolean;
  /** A player who left mid-round keeps the slot, dead, until the round ends. */
  left: boolean;
  x: number;
  y: number;
  dir: number;
  trail: Trail;
  /** How long the trail may grow in this life. */
  cap: number;
  rubber: number;
  /** Free ticks counted towards the next unit of rubber. */
  regen: number;
  boost: number;
  cooldown: number;
  turns: Turn[];
  respawnIn: number;
  kills: number;
  deaths: number;
  /** Ticks alive in the current life, and the best life so far. */
  life: number;
  longest: number;
  /** The wall key as the player last reported it. */
  held: boolean;
  /** Laying a wall right now. Always true in `always` mode. */
  lit: boolean;
  energy: number;
  /** Capacity in this life: grows with kills up to `energyMaxTicks`. */
  energyCap: number;
  /** Ticks without a wall counted towards the next unit of energy. */
  energyRegen: number;
}

export interface CyclesResultRow {
  publicId: string;
  name: string;
  kills: number;
  deaths: number;
  longest: number;
  rank: number;
}

export interface CyclesState {
  side: number;
  /** `0` is empty, otherwise the slot whose trail holds the cell. Index `y * side + x`. */
  field: Uint16Array;
  /** Ordered by slot. */
  bikes: Bike[];
  /** publicId → index into `bikes`: lookup by key, never a scan. */
  index: Record<string, number>;
  seed: number;
  tick: number;
  results: CyclesResultRow[] | null;
}

export function createCyclesState(seed: number): CyclesState {
  return {
    side: 0,
    field: new Uint16Array(0),
    bikes: [],
    index: {},
    seed,
    tick: 0,
    results: null,
  };
}
