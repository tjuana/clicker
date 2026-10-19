import {
  apply,
  type Command,
  type CyclesState,
  configFor,
  createRoomState,
  DEFAULT_CONFIG,
  type RoomState,
} from '@clicker/game';
import {
  type DeltaMessage,
  type FullMessage,
  PROTOCOL_VERSION,
  toDelta,
  toFull,
} from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { applyDelta, type CyclesModel, fromFull, type WallOp } from '../src/client/cycles/model';

const SIDE = 10;
const at = (x: number, y: number) => y * SIDE + x;

function bike(
  slot: number,
  trail: number[],
  overrides: Partial<FullMessage['bikes'][number]> = {},
): FullMessage['bikes'][number] {
  return {
    slot,
    id: String(slot),
    alive: trail.length > 0,
    dir: 0,
    trail,
    kills: 0,
    deaths: 0,
    rubber: 3,
    boost: 0,
    cooldown: 0,
    respawnIn: 0,
    ...overrides,
  };
}

function fullOf(bikes: FullMessage['bikes'], tick = 5): FullMessage {
  return { v: PROTOCOL_VERSION, type: 'full', tick, tickMs: 125, side: SIDE, bikes };
}

function deltaOf(t: number, parts: Partial<Omit<DeltaMessage, 'v' | 'type' | 't'>>): DeltaMessage {
  return { v: PROTOCOL_VERSION, type: 'delta', t, cells: [], heads: [], events: [], ...parts };
}

/** Applies a delta that must not be refused. */
function advance(model: CyclesModel, delta: DeltaMessage) {
  const result = applyDelta(model, delta);
  if (result === null) throw new Error(`delta ${delta.t} was refused at tick ${model.tick}`);
  return result;
}

describe('fromFull', () => {
  it('lays one wall per trail cell, oldest first, each joined to the cell before it', () => {
    const { walls } = fromFull(
      fullOf([bike(1, [at(1, 1), at(2, 1), at(3, 1)]), bike(2, [at(5, 5), at(5, 6)])]),
    );

    expect(walls).toEqual([
      { kind: 'put', cell: at(1, 1), slot: 1, from: -1 },
      { kind: 'put', cell: at(2, 1), slot: 1, from: at(1, 1) },
      { kind: 'put', cell: at(3, 1), slot: 1, from: at(2, 1) },
      { kind: 'put', cell: at(5, 5), slot: 2, from: -1 },
      { kind: 'put', cell: at(5, 6), slot: 2, from: at(5, 5) },
    ]);
  });

  it('takes the head, the HUD numbers and the table from the bikes, and no head for a dead one', () => {
    const { model } = fromFull(
      fullOf([
        bike(1, [at(1, 1), at(2, 1)], { dir: 0, rubber: 2, cooldown: 7, kills: 3, deaths: 1 }),
        bike(2, [], { alive: false, deaths: 4 }),
      ]),
    );

    expect(model.side).toBe(SIDE);
    expect(model.tickMs).toBe(125);
    expect(model.tick).toBe(5);
    expect([...model.ids]).toEqual([
      [1, '1'],
      [2, '2'],
    ]);
    expect([...model.heads.values()]).toEqual([
      { slot: 1, cell: at(2, 1), dir: 0, rubber: 2, cooldown: 7 },
    ]);
    expect(model.kills.get(1)).toBe(3);
    expect(model.deaths.get(2)).toBe(4);
  });
});

describe('applyDelta', () => {
  const start = () => fromFull(fullOf([bike(1, [at(1, 1), at(2, 1)])])).model;

  it('lays one wall for one step, joined to the previous head, and moves the head', () => {
    const result = advance(
      start(),
      deltaOf(6, { cells: [at(3, 1), 1], heads: [1, at(3, 1), 0, 3, 0] }),
    );

    expect(result.walls).toEqual([{ kind: 'put', cell: at(3, 1), slot: 1, from: at(2, 1) }]);
    expect(result.model.tick).toBe(6);
    expect(result.model.heads.get(1)?.cell).toBe(at(3, 1));
  });

  it('lays the middle cell too when a boost carries the head two cells', () => {
    const result = advance(
      start(),
      deltaOf(6, { cells: [at(3, 1), 1, at(4, 1), 1], heads: [1, at(4, 1), 0, 3, 28] }),
    );

    expect(result.walls).toEqual([
      { kind: 'put', cell: at(3, 1), slot: 1, from: at(2, 1) },
      { kind: 'put', cell: at(4, 1), slot: 1, from: at(3, 1) },
    ]);
  });

  it('finds the middle cell of a two-cell step down a column as well as along a row', () => {
    const model = fromFull(fullOf([bike(1, [at(4, 2), at(4, 3)], { dir: 1 })])).model;

    const { walls } = advance(
      model,
      deltaOf(6, { cells: [at(4, 4), 1, at(4, 5), 1], heads: [1, at(4, 5), 1, 3, 28] }),
    );

    expect(walls).toEqual([
      { kind: 'put', cell: at(4, 4), slot: 1, from: at(4, 3) },
      { kind: 'put', cell: at(4, 5), slot: 1, from: at(4, 4) },
    ]);
  });

  it('lays nothing for a bike that stalled, and lifts the tail the rules freed', () => {
    const result = advance(
      start(),
      deltaOf(6, { cells: [at(1, 1), 0], heads: [1, at(2, 1), 0, 2, 0] }),
    );

    expect(result.walls).toEqual([{ kind: 'lift', cell: at(1, 1) }]);
    expect(result.model.heads.get(1)).toMatchObject({ cell: at(2, 1), rubber: 2 });
  });

  it('lifts every cell of a trail that died, and drops its head and counts the kill and the death', () => {
    const model = fromFull(
      fullOf([bike(1, [at(1, 1), at(2, 1), at(3, 1)]), bike(2, [at(8, 8), at(8, 7)])]),
    ).model;

    const result = advance(
      model,
      deltaOf(6, {
        cells: [at(1, 1), 0, at(2, 1), 0, at(3, 1), 0, at(8, 6), 2],
        heads: [2, at(8, 6), 3, 3, 0],
        events: [{ type: 'died', slot: 1, by: 2 }],
      }),
    );

    expect(result.walls.filter((op) => op.kind === 'lift').map((op) => op.cell)).toEqual([
      at(1, 1),
      at(2, 1),
      at(3, 1),
    ]);
    expect(result.model.heads.has(1)).toBe(false);
    expect(result.model.deaths.get(1)).toBe(1);
    expect(result.model.kills.get(2)).toBe(1);
    expect(result.events).toEqual([{ type: 'died', slot: 1, by: 2 }]);
  });

  it('draws a respawned bike from its spawn cell: the first cell joins nothing, the step after it does', () => {
    const model = fromFull(fullOf([bike(1, [], { alive: false, respawnIn: 2 })])).model;

    // The rules place a bike and ride its first step in the same tick, so the delta has two
    // cells of the slot and names only the second as the head.
    const result = advance(
      model,
      deltaOf(6, {
        cells: [at(5, 5), 1, at(6, 5), 1],
        heads: [1, at(6, 5), 0, 3, 0],
        events: [{ type: 'respawned', slot: 1 }],
      }),
    );

    expect(result.walls).toEqual([
      { kind: 'put', cell: at(5, 5), slot: 1, from: -1 },
      { kind: 'put', cell: at(6, 5), slot: 1, from: at(5, 5) },
    ]);
  });

  it('lays a respawned bike that could not ride on as a single cell joined to nothing', () => {
    const model = fromFull(fullOf([bike(1, [], { alive: false, respawnIn: 2 })])).model;

    // Placed on the spot, then stalled by the rubber: it is on the spot at the end of the tick.
    const result = advance(
      model,
      deltaOf(6, {
        cells: [at(5, 5), 1],
        heads: [1, at(5, 5), 0, 3, 0],
        events: [{ type: 'respawned', slot: 1 }],
      }),
    );

    expect(result.walls).toEqual([{ kind: 'put', cell: at(5, 5), slot: 1, from: -1 }]);
  });

  it('refuses a gap in the ticks, so the caller asks for the whole round again', () => {
    expect(applyDelta(start(), deltaOf(7, {}))).toBeNull();
  });

  it('ignores a tick it has already seen, which a connection gets before its own full', () => {
    const model = start();

    const old = applyDelta(model, deltaOf(5, { cells: [at(9, 9), 1] }));
    const older = applyDelta(model, deltaOf(2, { cells: [at(9, 9), 1] }));

    expect(old?.walls).toEqual([]);
    expect(old?.model).toBe(model);
    expect(older?.walls).toEqual([]);
  });
});

/**
 * A round the real rules played, in the form it would go over the wire. The client has to end up
 * with exactly the walls the rules have, after every single tick: a wall too many or too few is
 * a trail drawn through a bike or a gap in a barrier.
 */
function record(ticks: number): {
  full: FullMessage;
  deltas: DeltaMessage[];
  fields: Uint16Array[];
} {
  const config = configFor('cycles', DEFAULT_CONFIG, 20);
  let state: RoomState = createRoomState();
  const run = (command: Command, now: number) => {
    const result = apply(state, command, now, config);
    state = result.state;
    return result.events;
  };
  run({ type: 'join', playerId: 'host', connectionId: 'c', name: 'Host', hostKey: 'k' }, 0);
  run({ type: 'setMode', playerId: 'host', mode: 'cycles' }, 0);
  run({ type: 'setSpeed', playerId: 'host', speed: 20 }, 0);
  for (let bot = 0; bot < 7; bot += 1) run({ type: 'addBot', playerId: 'host' }, 0);
  run({ type: 'start', playerId: 'host' }, 0);
  run({ type: 'tick' }, config.countdownMs);

  const full = toFull(state);
  if (full === null) throw new Error('a started light-cycle room has a field');
  const deltas: DeltaMessage[] = [];
  const fields: Uint16Array[] = [];
  for (let tick = 0; tick < ticks; tick += 1) {
    // The host plays too, so boosts and turns by a person are in the record, not only the bots'.
    if (tick % 31 === 5) {
      run({ type: 'input', playerId: 'host', input: { type: 'boost' } }, config.countdownMs);
    }
    if (tick % 9 === 4) {
      const side = tick % 2 === 0 ? 'left' : 'right';
      run({ type: 'input', playerId: 'host', input: { type: 'turn', side } }, config.countdownMs);
    }
    for (const event of run({ type: 'step' }, config.countdownMs)) {
      if (event.type !== 'stepped') continue;
      deltas.push(toDelta(event.tick, event.changes));
      fields.push((state.modeState as CyclesState).field);
    }
  }
  return { full, deltas, fields };
}

/** The walls a client holds, keyed by cell: what the scene would be showing. */
function holdWalls(into: Map<number, number>, ops: WallOp[], side: number) {
  for (const op of ops) {
    if (op.kind === 'lift') {
      into.delete(op.cell);
      continue;
    }
    if (op.from >= 0) {
      // A wall runs from the cell before it, so the two must touch and the one before must be there.
      const apart =
        Math.abs((op.cell % side) - (op.from % side)) +
        Math.abs(Math.floor(op.cell / side) - Math.floor(op.from / side));
      expect(apart).toBe(1);
      expect(into.get(op.from)).toBe(op.slot);
    }
    into.set(op.cell, op.slot);
  }
}

describe('replaying a recorded round', () => {
  const ticks = 200;
  const { full, deltas, fields } = record(ticks);

  it('is a round worth replaying: it holds boosts, deaths and respawns', () => {
    const events = deltas.flatMap((delta) => delta.events);
    expect(deltas).toHaveLength(ticks);
    expect(events.some((event) => event.type === 'boost')).toBe(true);
    expect(events.some((event) => event.type === 'died')).toBe(true);
    expect(events.some((event) => event.type === 'respawned')).toBe(true);
  });

  it('keeps exactly the rules field after every tick', () => {
    const start = fromFull(full);
    const walls = new Map<number, number>();
    holdWalls(walls, start.walls, start.model.side);
    let model = start.model;

    deltas.forEach((delta, index) => {
      const result = advance(model, delta);
      holdWalls(walls, result.walls, model.side);
      model = result.model;

      const field = fields[index] as Uint16Array;
      let live = 0;
      for (let cell = 0; cell < field.length; cell += 1) {
        const slot = field[cell] as number;
        if (slot !== 0) live += 1;
        // Only on a mismatch: a quarter of a million assertions would say the same, slowly.
        if ((walls.get(cell) ?? 0) !== slot) {
          expect(walls.get(cell) ?? 0, `cell ${cell} after tick ${delta.t}`).toBe(slot);
        }
      }
      expect(walls.size).toBe(live);
    });
  });
});
