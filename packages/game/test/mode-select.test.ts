import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { configFor } from '../src/room/config';
import { createRoomState } from '../src/room/state';
import {
  clickerOf,
  config,
  cyclesOf,
  deepFreeze,
  lobbyWithHost,
  player,
  room,
  run,
} from './support';

const CYCLES = configFor('cycles');

function lobbyOfThree() {
  return run(lobbyWithHost(), [
    { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    { type: 'setMode', playerId: 'host', mode: 'cycles' },
    { type: 'addBot', playerId: 'host' },
  ]);
}

describe('setMode', () => {
  it('seats every player of the room in the new mode', () => {
    const lobby = run(lobbyWithHost(), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    ]);

    const { state } = apply(lobby, { type: 'setMode', playerId: 'host', mode: 'cycles' }, 5000);

    expect(state.mode).toBe('cycles');
    expect(Object.keys(cyclesOf(state).index).sort()).toEqual(['1', '2']);
  });

  it('seats them in publicId order whatever order the room happens to list them in', () => {
    const lobby = room({
      hosts: ['b'],
      players: {
        b: player({ publicId: '2', name: 'Boris' }),
        a: player({ publicId: '1', name: 'Anna' }),
      },
    });

    const { state } = apply(lobby, { type: 'setMode', playerId: 'b', mode: 'cycles' }, 0);

    expect(cyclesOf(state).index).toEqual({ '1': 0, '2': 1 });
  });

  it('does not mutate the state it was given', () => {
    const lobby = deepFreeze(lobbyWithHost());

    expect(() =>
      apply(lobby, { type: 'setMode', playerId: 'host', mode: 'cycles' }, 5000),
    ).not.toThrow();
    expect(lobby.mode).toBe('clicker');
  });

  it('answers a stranger with not_joined and a guest with not_host', () => {
    const lobby = run(lobbyWithHost(), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    ]);

    expect(apply(lobby, { type: 'setMode', playerId: 'nobody', mode: 'cycles' }, 0).events).toEqual(
      [{ type: 'rejected', playerId: 'nobody', code: 'not_joined' }],
    );
    const refused = apply(lobby, { type: 'setMode', playerId: 'guest', mode: 'cycles' }, 0);
    expect(refused.events).toEqual([{ type: 'rejected', playerId: 'guest', code: 'not_host' }]);
    expect(refused.state.mode).toBe('clicker');
  });

  it.each(['countdown', 'running'] as const)('is refused during %s', (phase) => {
    const started = run(lobbyWithHost(), [{ type: 'start', playerId: 'host' }]);
    const now = phase === 'running' ? (started.round?.goAt ?? 0) : 0;
    const live = apply(started, { type: 'tick' }, now).state;
    expect(live.phase).toBe(phase);

    const result = apply(live, { type: 'setMode', playerId: 'host', mode: 'cycles' }, now);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'wrong_phase' }]);
    expect(result.state).toBe(live);
  });

  it('changes nothing when asked for the mode already in play', () => {
    const lobby = lobbyOfThree();

    const same = apply(lobby, { type: 'setMode', playerId: 'host', mode: 'cycles' }, 9000);

    expect(same.state).toBe(lobby);
    expect(same.events).toEqual([]);
  });

  it('sends the bots home when the new mode has none, and starts the scores from zero', () => {
    const lobby = lobbyOfThree();
    expect(Object.values(lobby.players).filter((p) => p.bot)).toHaveLength(1);

    const { state } = apply(lobby, { type: 'setMode', playerId: 'host', mode: 'clicker' }, 7000);

    expect(state.mode).toBe('clicker');
    expect(Object.values(state.players).some((p) => p.bot)).toBe(false);
    expect(Object.keys(clickerOf(state).scores).sort()).toEqual(['1', '2']);
    expect(Object.values(clickerOf(state).scores).map((score) => score.clicks)).toEqual([0, 0]);
  });

  it('forgets the last round in the mode it leaves', () => {
    let state = run(lobbyWithHost(), [{ type: 'start', playerId: 'host' }]);
    const goAt = state.round?.goAt ?? 0;
    state = apply(state, { type: 'input', playerId: 'host', input: { type: 'click' } }, goAt).state;
    state = apply(state, { type: 'tick' }, goAt + config().roundMs + 1000).state;
    expect(state.phase).toBe('results');
    expect(clickerOf(state).results).not.toBeNull();

    const there = apply(
      state,
      { type: 'setMode', playerId: 'host', mode: 'cycles' },
      goAt + 20_000,
    );
    expect(cyclesOf(there.state).results).toBeNull();

    const back = apply(
      there.state,
      { type: 'setMode', playerId: 'host', mode: 'clicker' },
      goAt + 21_000,
    );
    expect(clickerOf(back.state).results).toBeNull();
    expect(clickerOf(back.state).scores['1']?.clicks).toBe(0);
  });

  it('keeps the host a host and the public ids as they were', () => {
    const { state } = apply(
      lobbyOfThree(),
      { type: 'setMode', playerId: 'host', mode: 'clicker' },
      0,
    );

    expect(state.hosts).toEqual(['host']);
    expect(state.players.host?.publicId).toBe('1');
    expect(state.players.guest?.publicId).toBe('2');
  });
});

describe('the mode of a new room', () => {
  it('is the clicker, which has no tick', () => {
    expect(createRoomState().mode).toBe('clicker');
    expect(configFor(createRoomState().mode).tickMs).toBeNull();
    expect(CYCLES.tickMs).toBe(50);
  });
});
