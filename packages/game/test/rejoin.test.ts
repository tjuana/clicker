import { describe, expect, it } from 'vitest';
import { cyclesConfigFor, DEFAULT_CYCLES_SETTINGS } from '../src/modes/cycles';
import { apply } from '../src/room/apply';
import { configFor } from '../src/room/config';
import type { RoomState } from '../src/room/state';
import { clickerOf, cyclesOf, lobbyWithHost, run } from './support';

/** A room that never chose a speed rides at the default one. */
const RESPAWN_TICKS = cyclesConfigFor(DEFAULT_CYCLES_SETTINGS).respawnTicks;

const CYCLES = configFor('cycles');

/** A cycles round in `running` with the host, a guest (so the round outlives the host) and a bot. */
function cyclesRound(): { state: RoomState; goAt: number } {
  const lobby = run(
    lobbyWithHost(),
    [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
      { type: 'setMode', playerId: 'host', mode: 'cycles' },
      { type: 'addBot', playerId: 'host' },
      { type: 'start', playerId: 'host' },
    ],
    0,
    CYCLES,
  );
  const goAt = lobby.round?.goAt ?? 0;
  return { state: apply(lobby, { type: 'tick' }, goAt, CYCLES).state, goAt };
}

/** The host's kills are set by hand: arranging a real kill through the room would test the rules, not the rejoin. */
function withHostKills(state: RoomState, kills: number): RoomState {
  const cycles = cyclesOf(state);
  const position = cycles.index['1'] ?? -1;
  const bikes = cycles.bikes.map((bike, i) => (i === position ? { ...bike, kills } : bike));
  return { ...state, modeState: { ...cycles, bikes } };
}

function steps(state: RoomState, count: number, from: number): RoomState {
  let next = state;
  for (let i = 0; i < count; i += 1) {
    next = apply(next, { type: 'step' }, from + i, CYCLES).state;
  }
  return next;
}

describe('a player who comes back to a living round', () => {
  it('gets a living bike after the respawn wait and keeps their kills', () => {
    const { state, goAt } = cyclesRound();
    let next = withHostKills(state, 7);
    next = apply(
      next,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 1,
      CYCLES,
    ).state;
    next = steps(next, 1, goAt + 2);
    const hostBike = () => cyclesOf(next).bikes[cyclesOf(next).index['1'] ?? -1];
    expect(hostBike()?.alive).toBe(false);

    next = apply(
      next,
      { type: 'join', playerId: 'host', connectionId: 'c-again', name: 'Host' },
      goAt + 3,
      CYCLES,
    ).state;
    expect(hostBike()?.kills).toBe(7);

    next = steps(next, RESPAWN_TICKS - 1, goAt + 4);
    expect(hostBike()?.alive).toBe(false);
    next = steps(next, 1, goAt + 100);
    expect(hostBike()?.alive).toBe(true);
    expect(hostBike()?.kills).toBeGreaterThanOrEqual(7);
  });

  it('comes back to the same slot, not to a new bike', () => {
    const { state, goAt } = cyclesRound();
    const before = cyclesOf(state).bikes.length;
    let next = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 1,
      CYCLES,
    ).state;
    next = apply(
      next,
      { type: 'join', playerId: 'host', connectionId: 'c-again', name: 'Host' },
      goAt + 2,
      CYCLES,
    ).state;

    expect(cyclesOf(next).bikes).toHaveLength(before);
    expect(cyclesOf(next).bikes[cyclesOf(next).index['1'] ?? -1]?.left).toBe(false);
  });
});

describe('a player who comes back to the clicker', () => {
  it('keeps their score', () => {
    const started = run(lobbyWithHost(), [{ type: 'start', playerId: 'host' }]);
    const goAt = started.round?.goAt ?? 0;
    let state = apply(started, { type: 'tick' }, goAt).state;
    state = apply(
      state,
      { type: 'input', playerId: 'host', input: { type: 'click' } },
      goAt + 1,
    ).state;
    state = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 2,
    ).state;

    state = apply(
      state,
      { type: 'join', playerId: 'host', connectionId: 'c-again', name: 'Host' },
      goAt + 3,
    ).state;

    expect(clickerOf(state).scores['1']?.clicks).toBe(1);
  });
});

describe('a player who leaves during the countdown', () => {
  it('has their bike taken off the field by the first step', () => {
    const lobby = run(
      lobbyWithHost(),
      [
        { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
        { type: 'setMode', playerId: 'host', mode: 'cycles' },
        { type: 'start', playerId: 'host' },
      ],
      0,
      CYCLES,
    );
    expect(lobby.phase).toBe('countdown');
    const gone = apply(
      lobby,
      { type: 'leave', playerId: 'guest', connectionId: 'c-guest' },
      10,
      CYCLES,
    ).state;
    const goAt = gone.round?.goAt ?? 0;

    const running = apply(gone, { type: 'tick' }, goAt, CYCLES).state;
    const next = apply(running, { type: 'step' }, goAt + 1, CYCLES).state;

    const cycles = cyclesOf(next);
    const bike = cycles.bikes[cycles.index['2'] ?? -1];
    expect(bike?.alive).toBe(false);
    expect(cycles.field.includes(bike?.slot ?? 0)).toBe(false);
  });
});

describe('a person who is not connected when the host starts', () => {
  /** The guest closed the tab in the lobby; the reconnect grace has not run out, so they are still listed. */
  function startedWithoutGuest(): { state: RoomState; goAt: number } {
    const lobby = run(
      lobbyWithHost(),
      [
        { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
        { type: 'setMode', playerId: 'host', mode: 'cycles' },
        { type: 'leave', playerId: 'guest', connectionId: 'c-guest' },
        { type: 'start', playerId: 'host' },
      ],
      0,
      CYCLES,
    );
    const goAt = lobby.round?.goAt ?? 0;
    return { state: apply(lobby, { type: 'tick' }, goAt, CYCLES).state, goAt };
  }

  const livingIds = (state: RoomState): string[] =>
    cyclesOf(state)
      .bikes.filter((bike) => bike.alive)
      .map((bike) => bike.publicId);

  it('gets no bike on the field, however long the round runs', () => {
    const { state, goAt } = startedWithoutGuest();
    expect(state.players.guest?.connectionIds).toEqual([]);

    let next = state;
    for (let i = 0; i < RESPAWN_TICKS + 5; i += 1) {
      next = apply(next, { type: 'step' }, goAt + 1 + i, CYCLES).state;
      expect(livingIds(next)).not.toContain('2');
    }
    expect(cyclesOf(next).bikes.some((bike) => bike.publicId === '2' && bike.kills > 0)).toBe(
      false,
    );
  });

  it('is not counted when the field is sized and the bikes are spread', () => {
    const { state } = startedWithoutGuest();

    expect(cyclesOf(state).bikes.map((bike) => bike.publicId)).toEqual(['1']);
  });

  it('gets a bike after the respawn wait when they come back mid-round', () => {
    const { state, goAt } = startedWithoutGuest();
    let next = apply(
      state,
      { type: 'join', playerId: 'guest', connectionId: 'c-again', name: 'Guest' },
      goAt + 1,
      CYCLES,
    ).state;

    for (let i = 0; i < RESPAWN_TICKS - 1; i += 1) {
      next = apply(next, { type: 'step' }, goAt + 2 + i, CYCLES).state;
    }
    expect(livingIds(next)).not.toContain('2');
    next = apply(next, { type: 'step' }, goAt + 100, CYCLES).state;
    expect(livingIds(next)).toContain('2');
  });
});
