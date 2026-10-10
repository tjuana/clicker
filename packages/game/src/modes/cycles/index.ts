import type { CyclesConfig } from './config';
import { openestDirection, sideFor } from './field';
import type { Spot } from './spawn';
import type { Bike, CyclesInput, CyclesResultRow, CyclesState } from './state';
import { place, type Work } from './step';
import { emptyTrail, forEachCell } from './trail';

export { CYCLES_CONFIG, type CyclesConfig } from './config';
export {
  type Bike,
  type CyclesInput,
  type CyclesResultRow,
  type CyclesState,
  createCyclesState,
  type Turn,
} from './state';
export { type CyclesEvent, step, type TickChanges } from './step';

/** A bike waiting in the lobby: no position until a round places it. */
function newBike(slot: number, publicId: string, bot: boolean, config: CyclesConfig): Bike {
  return {
    slot,
    publicId,
    bot,
    alive: false,
    left: false,
    x: 0,
    y: 0,
    dir: 0,
    trail: emptyTrail(config.trailMax),
    cap: config.trail,
    rubber: config.rubber,
    regen: 0,
    boost: 0,
    cooldown: 0,
    turns: [],
    // A late joiner waits out a respawn and enters the running round; in the lobby it is ignored.
    respawnIn: config.respawnTicks,
    kills: 0,
    deaths: 0,
    life: 0,
    longest: 0,
  };
}

export function addPlayer(
  state: CyclesState,
  publicId: string,
  bot: boolean,
  config: CyclesConfig,
): CyclesState {
  if (state.index[publicId] !== undefined) return state;
  const bike = newBike(state.bikes.length + 1, publicId, bot, config);
  return {
    ...state,
    bikes: [...state.bikes, bike],
    index: { ...state.index, [publicId]: state.bikes.length },
  };
}

/**
 * Outside a round only. Slots are renumbered so they stay 1…n and fit the field, and the field
 * is cleared because its cells name the old slots; the next round rebuilds it anyway.
 */
export function removePlayers(state: CyclesState, publicIds: string[]): CyclesState {
  if (publicIds.length === 0) return state;
  const leaving = new Set(publicIds);
  const bikes = state.bikes
    .filter((bike) => !leaving.has(bike.publicId))
    .map((bike, position) => ({ ...bike, slot: position + 1, alive: false }));
  const index: Record<string, number> = {};
  bikes.forEach((bike, position) => {
    index[bike.publicId] = position;
  });
  return { ...state, bikes, index, field: new Uint16Array(state.side * state.side) };
}

/**
 * Start positions on an even lattice: √n columns by as many rows as the head count needs, each
 * bike in the middle of its own block. Dividing the rows by the column count instead leaves a
 * lone row crowded into the top of the field.
 *
 * A bike faces its longest open run on the field as placed so far, ties to the lowest direction,
 * so nobody starts pointed at a wall or at a neighbour a few cells away. That is four short runs
 * per bike, O(n × side) for the round. Placing every bike with the respawn search instead would
 * cost a full pass over the field per bike — O(n × cells), and cells grow with n.
 */
function startSpot(position: number, count: number, work: Work): Spot {
  const { field, side } = work;
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const x = Math.floor(((2 * (position % columns) + 1) * side) / (2 * columns));
  const y = Math.floor(((2 * Math.floor(position / columns) + 1) * side) / (2 * rows));
  return { x, y, dir: openestDirection(field, side, x, y) };
}

/** Sizes the field for whoever is here and spreads the bikes evenly over it. */
export function startRound(state: CyclesState, config: CyclesConfig): CyclesState {
  const staying = state.bikes.filter((bike) => !bike.left);
  const side = sideFor(staying.length, config);
  const work: Work = {
    field: new Uint16Array(side * side),
    side,
    bikes: staying.map((bike, position) => newBike(position + 1, bike.publicId, bike.bot, config)),
    touched: new Set(),
    events: [],
    config,
  };
  work.bikes.forEach((bike, position) => {
    place(work, bike, startSpot(position, work.bikes.length, work));
  });
  const index: Record<string, number> = {};
  work.bikes.forEach((bike, position) => {
    index[bike.publicId] = position;
  });
  return { ...state, side, field: work.field, bikes: work.bikes, index, tick: 0, results: null };
}

function withBike(state: CyclesState, position: number, bike: Bike): CyclesState {
  const bikes = [...state.bikes];
  bikes[position] = bike;
  return { ...state, bikes };
}

export function applyInput(
  state: CyclesState,
  publicId: string,
  input: CyclesInput,
  config: CyclesConfig,
): CyclesState {
  const position = state.index[publicId];
  const bike = position === undefined ? undefined : state.bikes[position];
  if (position === undefined || bike === undefined || !bike.alive) return state;

  if (input.type === 'turn') {
    if (bike.turns.length >= config.turnQueue) return state;
    return withBike(state, position, { ...bike, turns: [...bike.turns, input.side] });
  }
  if (bike.boost > 0 || bike.cooldown > 0) return state;
  return withBike(state, position, {
    ...bike,
    boost: config.boostTicks,
    cooldown: config.boostTicks + config.boostCooldownTicks,
  });
}

/**
 * A player who left mid-round. Its bike is taken off the field with no one to blame, and it
 * keeps its slot until the round ends: renumbering now would rewrite every cell it ever owned.
 */
export function leave(state: CyclesState, publicId: string): CyclesState {
  const position = state.index[publicId];
  const bike = position === undefined ? undefined : state.bikes[position];
  if (position === undefined || bike === undefined || bike.left) return state;
  const field = state.field.slice();
  forEachCell(bike.trail, (cell) => {
    field[cell] = 0;
  });
  return {
    ...withBike(state, position, {
      ...bike,
      alive: false,
      left: true,
      trail: emptyTrail(bike.trail.cells.length),
      longest: Math.max(bike.longest, bike.life),
    }),
    field,
  };
}

/**
 * Most kills first; then fewest deaths; then the longest single life, counting the one still
 * running. The built-in sort is stable and adaptive, which is all a table of twenty needs.
 */
export function finish(state: CyclesState, names: Record<string, string>): CyclesState {
  const results: CyclesResultRow[] = state.bikes
    .map((bike) => ({
      publicId: bike.publicId,
      name: names[bike.publicId] ?? '',
      kills: bike.kills,
      deaths: bike.deaths,
      longest: Math.max(bike.longest, bike.life),
      rank: 0,
      slot: bike.slot,
    }))
    .sort(
      (a, b) =>
        b.kills - a.kills || a.deaths - b.deaths || b.longest - a.longest || a.slot - b.slot,
    )
    .map(({ slot: _slot, ...row }, position) => ({ ...row, rank: position + 1 }));
  return { ...state, results };
}
