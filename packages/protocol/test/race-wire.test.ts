import {
  apply,
  type Command,
  configFor,
  createRoomState,
  type GameEvent,
  type RaceState,
  type RoomState,
} from '@clicker/game';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/client';
import { parseServerMessage, toDelta, toFull, toSnapshot } from '../src/server';

type Stepped = Extract<GameEvent, { type: 'stepped' }>;

const RACE = configFor('race');

/** A race room: the host and `bots` bots, started, the lights out, then stepped `steps` times. */
function raceRoom(
  bots: number,
  steps: number,
  mask = 0,
): { state: RoomState; stepped: Stepped | null } {
  const commands: Command[] = [
    {
      type: 'join',
      playerId: 'secret-host',
      connectionId: 'conn-host',
      name: 'Аня',
      hostKey: 'key-1',
    },
    { type: 'setMode', playerId: 'secret-host', mode: 'race' },
    ...Array.from({ length: bots }, (): Command => ({ type: 'addBot', playerId: 'secret-host' })),
    { type: 'start', playerId: 'secret-host' },
  ];
  let state = createRoomState();
  for (const command of commands) state = apply(state, command, 0, RACE).state;
  const goAt = state.round?.goAt ?? 0;
  state = apply(state, { type: 'tick' }, goAt, RACE).state;
  state = apply(
    state,
    { type: 'input', playerId: 'secret-host', input: { type: 'keys', mask } },
    goAt,
    RACE,
  ).state;

  let stepped: Stepped | null = null;
  for (let i = 0; i < steps; i += 1) {
    const result = apply(state, { type: 'step' }, goAt + i, RACE);
    state = result.state;
    stepped = result.events.find((event): event is Stepped => event.type === 'stepped') ?? stepped;
  }
  return { state, stepped };
}

describe('the race snapshot', () => {
  it('names the mode, has no results in a lobby and passes its own schema', () => {
    let state = createRoomState();
    state = apply(
      state,
      { type: 'join', playerId: 'p', connectionId: 'c', name: 'Аня', hostKey: 'k' },
      0,
    ).state;
    state = apply(state, { type: 'setMode', playerId: 'p', mode: 'race' }, 0).state;

    const snapshot = toSnapshot(state, 5);

    expect(snapshot.mode).toBe('race');
    expect(snapshot.data).toEqual({ results: null });
    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('carries the results under public ids and names once the race is over', () => {
    const { state } = raceRoom(2, 3);
    const over = apply(state, { type: 'tick' }, 10_000_000, RACE).state;
    expect(over.phase).toBe('results');

    const snapshot = toSnapshot(over, 10_000_000);

    if (snapshot.mode !== 'race') throw new Error('not a race snapshot');
    const rows = snapshot.data.results ?? [];
    expect(rows.map((row) => row.id).sort()).toEqual(['1', '2', '3']);
    expect(rows.find((row) => row.id === '1')?.name).toBe('Аня');
    expect(rows.map((row) => row.rank).sort()).toEqual([1, 2, 3]);
    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
    expect(JSON.stringify(snapshot)).not.toContain('secret');
  });

  it('keeps a name in the results after the player is gone from the room', () => {
    const { state } = raceRoom(2, 3);
    const over = apply(state, { type: 'tick' }, 10_000_000, RACE).state;
    const left = apply(
      over,
      { type: 'leave', playerId: 'secret-host', connectionId: 'conn-host' },
      10_000_000,
      RACE,
    ).state;
    // Past the grace, outside a round: the room forgets the player, the results must not.
    const later = 10_000_000 + RACE.reconnectGraceMs + 1;
    const forgotten = apply(left, { type: 'tick' }, later, RACE).state;
    expect(Object.values(forgotten.players).map((player) => player.publicId)).not.toContain('1');

    const snapshot = toSnapshot(forgotten, later);

    if (snapshot.mode !== 'race') throw new Error('not a race snapshot');
    expect(snapshot.data.results?.find((row) => row.id === '1')?.name).toBe('Аня');
  });

  it('is refused when it carries another mode’s data', () => {
    const { state } = raceRoom(1, 1);
    const snapshot = toSnapshot(state, 0);

    expect(
      parseServerMessage(JSON.stringify({ ...snapshot, data: { scores: {}, results: null } })),
    ).toBeNull();
  });
});

describe('the race full', () => {
  it('says the track, the pace and the laps, lists the cars and passes its schema', () => {
    const { state } = raceRoom(3, 5);

    const full = toFull(state);

    if (full?.mode !== 'race') throw new Error('expected a race full');
    expect(full.track).toBe('ring');
    expect(full.tickMs).toBeCloseTo(1000 / 30);
    expect(full.laps).toBe(3);
    expect(full.tick).toBe(5);
    expect(full.cars.map((car) => car.slot).sort()).toEqual([0, 1, 2, 3]);
    expect(full.cars.map((car) => car.id).sort()).toEqual(['1', '2', '3', '4']);
    expect(full.cars.filter((car) => car.bot)).toHaveLength(3);
    expect(parseServerMessage(JSON.stringify(full))).toEqual(full);
    expect(JSON.stringify(full)).not.toContain('secret');
  });

  it('is null in a lobby, where nobody stands on the grid', () => {
    let state = createRoomState();
    state = apply(
      state,
      { type: 'join', playerId: 'p', connectionId: 'c', name: 'Аня', hostKey: 'k' },
      0,
    ).state;
    state = apply(state, { type: 'setMode', playerId: 'p', mode: 'race' }, 0).state;

    expect(toFull(state)).toBeNull();
  });

  it('leaves out a car that joined in the middle of the race', () => {
    const { state } = raceRoom(1, 5);
    const joined = apply(
      state,
      { type: 'join', playerId: 'secret-late', connectionId: 'conn-late', name: 'Боря' },
      1000,
      RACE,
    ).state;

    const full = toFull(joined);

    if (full?.mode !== 'race') throw new Error('expected a race full');
    expect(full.cars.map((car) => car.id).sort()).toEqual(['1', '2']);
  });

  it('is refused without its mode', () => {
    const { mode: _mode, ...bare } = toFull(raceRoom(1, 1).state) as NonNullable<
      ReturnType<typeof toFull>
    >;

    expect(parseServerMessage(JSON.stringify(bare))).toBeNull();
  });

  it('is refused with a field it does not know', () => {
    const full = toFull(raceRoom(1, 1).state);

    expect(parseServerMessage(JSON.stringify({ ...full, extra: 1 }))).toBeNull();
  });
});

describe('the race delta', () => {
  it('carries the tick and one flat seven-tuple per car on the field', () => {
    const { state, stepped } = raceRoom(3, 4, 1);

    const delta = toDelta(state, stepped as Stepped);

    if (delta.mode !== 'race') throw new Error('expected a race delta');
    expect(delta.t).toBe(4);
    expect(delta.cars).toHaveLength(4 * 7);
    const race = state.modeState as RaceState;
    for (let i = 0; i < delta.cars.length; i += 7) {
      const car = race.cars.find((own) => own.slot === delta.cars[i]);
      expect(car).toBeDefined();
      expect(delta.cars.slice(i + 1, i + 6)).toEqual([
        car?.x,
        car?.y,
        car?.heading,
        car?.speed,
        car?.lap,
      ]);
    }
    expect(parseServerMessage(JSON.stringify(delta))).toEqual(delta);
  });

  it('shows the gas of the player’s car as speed', () => {
    const { state, stepped } = raceRoom(1, 6, 1);
    const delta = toDelta(state, stepped as Stepped);

    if (delta.mode !== 'race') throw new Error('expected a race delta');
    const own = (state.modeState as RaceState).cars.find((car) => car.publicId === '1');
    const at = delta.cars.indexOf(own?.slot as number);
    expect(delta.cars[at + 4]).toBeGreaterThan(0);
  });

  it('describes every kind of event', () => {
    const { state } = raceRoom(1, 1);
    const delta = toDelta(state, {
      type: 'stepped',
      tick: 9,
      mode: 'race',
      changes: { laps: [{ slot: 1, lap: 2 }], finished: [0], bumped: [1, 0] },
    });

    if (delta.mode !== 'race') throw new Error('expected a race delta');
    expect(delta.events).toEqual([
      { type: 'lap', slot: 1, lap: 2 },
      { type: 'finished', slot: 0 },
      { type: 'bump', slot: 1 },
      { type: 'bump', slot: 0 },
    ]);
    expect(parseServerMessage(JSON.stringify(delta))).toEqual(delta);
  });

  it('is refused without its mode', () => {
    const { state, stepped } = raceRoom(1, 1);
    const { mode: _mode, ...bare } = toDelta(state, stepped as Stepped);

    expect(parseServerMessage(JSON.stringify(bare))).toBeNull();
  });

  it('is refused when a car tuple is not whole numbers', () => {
    const { state, stepped } = raceRoom(1, 1);
    const delta = toDelta(state, stepped as Stepped);

    expect(parseServerMessage(JSON.stringify({ ...delta, cars: ['x'] }))).toBeNull();
  });

  // Measured on 2026-10-27: twenty cars, tick 600 (20 s into the race, nineteen bots at speed),
  // `JSON.stringify` length 856 bytes, about 25 KB/s per player at 30 Hz. The spec guessed 0.6 KB:
  // the coordinates are five digits each. Binary stays out of the picture until a number says so
  // (plan 5's A14); the bound is the measurement rounded up, so growth shows.
  it('stays under a kilobyte for twenty cars', () => {
    const { state, stepped } = raceRoom(19, 600);
    const raw = JSON.stringify(toDelta(state, stepped as Stepped));

    expect(parseServerMessage(raw)).not.toBeNull();
    expect(raw.length).toBeLessThan(900);
  });

  it('carries the protocol version', () => {
    const { state, stepped } = raceRoom(1, 1);

    expect(toDelta(state, stepped as Stepped).v).toBe(PROTOCOL_VERSION);
  });
});
