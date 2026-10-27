import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { configFor } from '../src/room/config';
import type { RoomState } from '../src/room/state';
import { lobbyWithHost, raceOf, run } from './support';

const RACE = configFor('race');

/** The host, a guest and two bots, in the race. */
function lobby(): RoomState {
  return run(
    lobbyWithHost(),
    [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
      { type: 'setMode', playerId: 'host', mode: 'race' },
      { type: 'addBot', playerId: 'host' },
      { type: 'addBot', playerId: 'host' },
    ],
    0,
    RACE,
  );
}

function running(): { state: RoomState; goAt: number } {
  const started = apply(lobby(), { type: 'start', playerId: 'host' }, 0, RACE).state;
  const goAt = started.round?.goAt ?? 0;
  const state = apply(started, { type: 'tick' }, goAt, RACE).state;
  expect(state.phase).toBe('running');
  return { state, goAt };
}

describe('the ring race in a room', () => {
  it('has the race its own pace, size and length', () => {
    expect(RACE.roundMs).toBe(300_000);
    expect(RACE.maxPlayers).toBe(20);
    expect(RACE.tickMs).toBe(1000 / 30);
  });

  it('seats everyone as a car when the host picks it, and brings the bots along', () => {
    const joined = run(lobbyWithHost(), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
      // The clicker has no bots, so the bot is seated in the light cycles first.
      { type: 'setMode', playerId: 'host', mode: 'cycles' },
      { type: 'addBot', playerId: 'host' },
    ]);
    // The bot stays only in a mode that plays it; the race does.
    const { state } = apply(joined, { type: 'setMode', playerId: 'host', mode: 'race' }, 5000);

    expect(state.mode).toBe('race');
    expect(
      raceOf(state)
        .cars.map((car) => car.publicId)
        .sort(),
    ).toEqual(['1', '2', '3']);
    expect(raceOf(state).cars.filter((car) => car.bot)).toHaveLength(1);
  });

  it('adds bots and takes the newest away', () => {
    const base = lobby();
    expect(raceOf(base).cars).toHaveLength(4);

    const fewer = apply(base, { type: 'removeBot', playerId: 'host' }, 0, RACE).state;

    expect(
      raceOf(fewer)
        .cars.map((car) => car.publicId)
        .sort(),
    ).toEqual(['1', '2', '3']);
  });

  it('refuses a bot beyond the race’s twenty', () => {
    let state = lobby();
    for (let i = 0; i < 16; i += 1) {
      state = apply(state, { type: 'addBot', playerId: 'host' }, 0, RACE).state;
    }
    expect(raceOf(state).cars).toHaveLength(20);

    const { events } = apply(state, { type: 'addBot', playerId: 'host' }, 0, RACE);

    expect(events).toEqual([{ type: 'rejected', playerId: 'host', code: 'room_full' }]);
  });

  it('puts the cars on the grid when the round starts', () => {
    const started = apply(lobby(), { type: 'start', playerId: 'host' }, 0, RACE).state;

    const places = new Set(raceOf(started).cars.map((car) => `${car.x},${car.y}`));
    expect(places.size).toBe(4);
  });

  it('advances the race by one tick a step, and says so with the mode that made it', () => {
    const { state, goAt } = running();

    const { state: next, events } = apply(state, { type: 'step' }, goAt + 34, RACE);

    expect(raceOf(next).tick).toBe(raceOf(state).tick + 1);
    expect(events).toHaveLength(1);
    const [event] = events;
    expect(event?.type).toBe('stepped');
    if (event?.type !== 'stepped') return;
    expect(event.tick).toBe(raceOf(next).tick);
    expect(event.mode).toBe('race');
    if (event.mode !== 'race') return;
    expect(event.changes.laps).toEqual([]);
  });
});
