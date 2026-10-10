import { decide } from './bot';
import type { CyclesConfig } from './config';
import { pickSpawn, type Spot } from './spawn';
import { type Bike, type CyclesState, DX, DY } from './state';
import { copyTrail, dropOldest, forEachCell, oldestCell, pushNewest } from './trail';

export type CyclesEvent =
  | { type: 'died'; slot: number; by: number | null }
  | { type: 'respawned'; slot: number }
  | { type: 'boost'; slot: number };

/**
 * What one tick changed. The step knows this already; recovering it by comparing two fields
 * would be a pass over every cell just to rediscover it.
 *
 * Cells are reported as their final value, not as a log of writes: within one tick a cell can be
 * taken and freed again (a boosting bike enters it and dies), and two separate lists lose which
 * came last. A final value has no order to lose, so a client can replay it in any sequence.
 */
export interface TickChanges {
  /** Flat pairs: cell, what it holds after the tick (0 = empty). Each cell appears once. */
  cells: number[];
  /** Flat triples for every bike alive after the tick, in slot order: slot, head cell, direction. */
  heads: number[];
  events: CyclesEvent[];
}

/** Everything a tick writes to: copies, so the state it was given is never touched. */
export interface Work {
  field: Uint16Array;
  side: number;
  bikes: Bike[];
  /** Every cell the tick wrote. A `Set` keeps insertion order, so the report is deterministic. */
  touched: Set<number>;
  events: CyclesEvent[];
  config: CyclesConfig;
}

export function place(work: Work, bike: Bike, spot: Spot): void {
  const cell = spot.y * work.side + spot.x;
  bike.alive = true;
  bike.x = spot.x;
  bike.y = spot.y;
  bike.dir = spot.dir;
  bike.trail.start = 0;
  bike.trail.size = 0;
  pushNewest(bike.trail, cell);
  bike.cap = work.config.trail;
  bike.rubber = work.config.rubber;
  bike.regen = 0;
  bike.boost = 0;
  bike.turns = [];
  bike.life = 0;
  bike.respawnIn = 0;
  work.field[cell] = bike.slot;
  work.touched.add(cell);
}

function kill(work: Work, bike: Bike, by: number | null): void {
  bike.alive = false;
  bike.deaths += 1;
  bike.longest = Math.max(bike.longest, bike.life);
  bike.life = 0;
  bike.respawnIn = work.config.respawnTicks;
  bike.boost = 0;
  bike.turns = [];
  // The trail goes out with its rider: a dead bike must not keep walling the living in.
  forEachCell(bike.trail, (cell) => {
    work.field[cell] = 0;
    work.touched.add(cell);
  });
  bike.trail.start = 0;
  bike.trail.size = 0;
  bike.cap = work.config.trail;
  work.events.push({ type: 'died', slot: bike.slot, by });

  if (by === null) return;
  const killer = work.bikes[by - 1];
  if (killer === undefined) return;
  killer.kills += 1;
  killer.cap = Math.min(work.config.trailMax, killer.cap + work.config.killBonus);
}

const ADVANCE = 0;
const STALL = 1;
const CRASH = 2;

/**
 * One cell of movement for every bike in `movers`, all at once.
 *
 * Simultaneous, not in turn: each bike's fate is settled against the field as it stood before
 * anyone moved, so the order the bikes are listed in cannot change who lives. Two rules feed
 * each other — a tail only moves out of the way if its own bike advances, and a bike only
 * advances if its way is clear — so fates are settled by iterating to a fixed point. Fates only
 * ever change from "advance" to something else, which bounds the loop by the number of movers.
 */
function substep(work: Work, movers: Bike[]): void {
  const { field, side } = work;
  const count = movers.length;
  if (count === 0) return;

  const targets = new Int32Array(count);
  const tails = new Int32Array(count);
  const fates = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    const bike = movers[i] as Bike;
    const x = bike.x + (DX[bike.dir as 0] ?? 0);
    const y = bike.y + (DY[bike.dir as 0] ?? 0);
    targets[i] = x >= 0 && y >= 0 && x < side && y < side ? y * side + x : -1;
    // Only a full trail gives up its oldest cell; a growing one keeps it.
    tails[i] = bike.trail.size >= bike.cap ? oldestCell(bike.trail) : -1;
  }

  for (;;) {
    let changed = false;
    const vacated = new Set<number>();
    const aimed = new Map<number, number>();
    for (let i = 0; i < count; i += 1) {
      if (fates[i] !== ADVANCE) continue;
      if ((tails[i] ?? -1) >= 0) vacated.add(tails[i] ?? -1);
      const target = targets[i] ?? -1;
      if (target >= 0) aimed.set(target, (aimed.get(target) ?? 0) + 1);
    }
    for (let i = 0; i < count; i += 1) {
      if (fates[i] !== ADVANCE) continue;
      const target = targets[i] ?? -1;
      if (target < 0 || (field[target] !== 0 && !vacated.has(target))) {
        fates[i] = STALL;
        changed = true;
      } else if ((aimed.get(target) ?? 0) > 1) {
        fates[i] = CRASH;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // Tails first, then heads: a head may take the very cell a tail just left.
  for (let i = 0; i < count; i += 1) {
    const tail = tails[i] ?? -1;
    if (fates[i] !== ADVANCE || tail < 0) continue;
    dropOldest((movers[i] as Bike).trail);
    field[tail] = 0;
    work.touched.add(tail);
  }
  for (let i = 0; i < count; i += 1) {
    if (fates[i] !== ADVANCE) continue;
    const bike = movers[i] as Bike;
    const target = targets[i] ?? 0;
    field[target] = bike.slot;
    pushNewest(bike.trail, target);
    bike.x = target % side;
    bike.y = (target - bike.x) / side;
    work.touched.add(target);
    bike.regen += 1;
    if (bike.regen >= work.config.rubberRegenTicks) {
      bike.regen = 0;
      bike.rubber = Math.min(work.config.rubber, bike.rubber + 1);
    }
  }

  for (let i = 0; i < count; i += 1) {
    const bike = movers[i] as Bike;
    if (fates[i] === CRASH) {
      kill(work, bike, null);
    } else if (fates[i] === STALL) {
      bike.regen = 0;
      if (bike.rubber > 0) {
        bike.rubber -= 1;
        continue;
      }
      const target = targets[i] ?? -1;
      const owner = target < 0 ? 0 : (field[target] ?? 0);
      kill(work, bike, owner === 0 || owner === bike.slot ? null : owner);
    }
  }
}

export function step(
  prev: CyclesState,
  config: CyclesConfig,
): { state: CyclesState; changes: TickChanges } {
  const work: Work = {
    field: prev.field.slice(),
    side: prev.side,
    bikes: prev.bikes.map((bike) => ({
      ...bike,
      trail: copyTrail(bike.trail),
      turns: [...bike.turns],
    })),
    touched: new Set(),
    events: [],
    config,
  };
  let seed = prev.seed;

  for (const bike of work.bikes) {
    if (bike.alive || bike.left) continue;
    if (bike.respawnIn > 0) bike.respawnIn -= 1;
    if (bike.respawnIn > 0) continue;
    const picked = pickSpawn(work.field, work.side, seed);
    seed = picked.seed;
    if (picked.spot === null) continue;
    place(work, bike, picked.spot);
    work.events.push({ type: 'respawned', slot: bike.slot });
  }

  for (const bike of work.bikes) {
    if (!bike.alive) continue;
    if (bike.bot && bike.turns.length === 0) {
      const decided = decide(work.field, work.side, bike, config, seed);
      seed = decided.seed;
      if (decided.turn !== null) bike.turns.push(decided.turn);
    }
    const turn = bike.turns.shift();
    if (turn !== undefined) bike.dir = turn === 'left' ? (bike.dir + 3) & 3 : (bike.dir + 1) & 3;
    if (bike.boost === config.boostTicks) work.events.push({ type: 'boost', slot: bike.slot });
  }

  substep(
    work,
    work.bikes.filter((bike) => bike.alive),
  );
  substep(
    work,
    work.bikes.filter((bike) => bike.alive && bike.boost > 0),
  );

  for (const bike of work.bikes) {
    if (bike.boost > 0) bike.boost -= 1;
    if (bike.cooldown > 0) bike.cooldown -= 1;
    if (bike.alive) bike.life += 1;
  }

  const cells: number[] = [];
  for (const cell of work.touched) cells.push(cell, work.field[cell] ?? 0);
  const heads: number[] = [];
  for (const bike of work.bikes) {
    if (bike.alive) heads.push(bike.slot, bike.y * work.side + bike.x, bike.dir);
  }

  return {
    state: { ...prev, field: work.field, bikes: work.bikes, seed, tick: prev.tick + 1 },
    changes: { cells, heads, events: work.events },
  };
}
