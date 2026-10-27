import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { configFor } from '../src/room/config';
import type { RoomState } from '../src/room/state';
import { clickerOf, cyclesOf, lobbyWithHost, run } from './support';

const CYCLES = configFor('cycles');

/** A room in cycles: the host, two bots and, optionally, a second person. */
function lobby(withGuest = false): RoomState {
  const commands = [
    ...(withGuest
      ? [{ type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' } as const]
      : []),
    { type: 'setMode', playerId: 'host', mode: 'cycles' } as const,
    { type: 'addBot', playerId: 'host' } as const,
    { type: 'addBot', playerId: 'host' } as const,
  ];
  return run(lobbyWithHost(), commands, 0, CYCLES);
}

/** The round started and moved into `running` by a tick after `goAt`. */
function running(withGuest = false): { state: RoomState; goAt: number } {
  const started = apply(lobby(withGuest), { type: 'start', playerId: 'host' }, 0, CYCLES).state;
  const goAt = started.round?.goAt ?? 0;
  const state = apply(started, { type: 'tick' }, goAt, CYCLES).state;
  expect(state.phase).toBe('running');
  return { state, goAt };
}

describe('start in a living mode', () => {
  it('puts every bike on the field before the countdown ends', () => {
    const started = apply(lobby(), { type: 'start', playerId: 'host' }, 0, CYCLES).state;

    expect(started.phase).toBe('countdown');
    expect(cyclesOf(started).bikes.map((bike) => bike.alive)).toEqual([true, true, true]);
  });
});

describe('step', () => {
  it('moves the round by one tick and says what changed, once', () => {
    const { state, goAt } = running();

    const first = apply(state, { type: 'step' }, goAt + 50, CYCLES);

    expect(first.events).toHaveLength(1);
    const [event] = first.events;
    expect(event?.type).toBe('stepped');
    if (event?.type !== 'stepped') return;
    expect(event.tick).toBe(cyclesOf(state).tick + 1);
    expect(event.tick).toBe(cyclesOf(first.state).tick);
    expect(event.mode).toBe('cycles');
    if (event.mode !== 'cycles') return;
    expect(event.changes.cells.length).toBeGreaterThan(0);
  });

  it('counts one tick per step', () => {
    const { state, goAt } = running();

    let next = state;
    for (let i = 0; i < 5; i += 1) {
      next = apply(next, { type: 'step' }, goAt + 50 * (i + 1), CYCLES).state;
    }

    expect(cyclesOf(next).tick).toBe(cyclesOf(state).tick + 5);
  });

  it('is not an error before the round and after it: a timer can wake on the edge', () => {
    const idle = lobby();
    const inLobby = apply(idle, { type: 'step' }, 10, CYCLES);
    expect(inLobby.state).toBe(idle);
    expect(inLobby.events).toEqual([]);

    const counting = apply(idle, { type: 'start', playerId: 'host' }, 10, CYCLES).state;
    const inCountdown = apply(counting, { type: 'step' }, 11, CYCLES);
    expect(inCountdown.state).toBe(counting);
    expect(inCountdown.events).toEqual([]);

    const { state, goAt } = running();
    const over = apply(state, { type: 'tick' }, goAt + CYCLES.roundMs + CYCLES.lateGraceMs, CYCLES);
    const afterwards = apply(over.state, { type: 'step' }, goAt + CYCLES.roundMs + 1000, CYCLES);
    expect(afterwards.state).toBe(over.state);
    expect(afterwards.events).toEqual([]);
  });

  it('does nothing in a mode that cannot step, round running or not', () => {
    const clicker = run(lobbyWithHost(), [{ type: 'start', playerId: 'host' }]);
    const goAt = clicker.round?.goAt ?? 0;
    const live = apply(clicker, { type: 'tick' }, goAt).state;
    expect(live.phase).toBe('running');

    const result = apply(live, { type: 'step' }, goAt + 10);

    expect(result.state).toBe(live);
    expect(result.events).toEqual([]);
  });

  it('does not step a round whose time ran out on the way to the step', () => {
    const { state, goAt } = running();

    const result = apply(
      state,
      { type: 'step' },
      goAt + CYCLES.roundMs + CYCLES.lateGraceMs,
      CYCLES,
    );

    expect(result.state.phase).toBe('results');
    expect(result.events.map((event) => event.type)).toEqual(['phaseChanged']);
    expect(cyclesOf(result.state).tick).toBe(cyclesOf(state).tick);
  });
});

describe('a person who leaves a living round', () => {
  const GRACE = CYCLES.desertedGraceMs;

  it('lets it go on inside the grace: a network blip must not end a solo round', () => {
    const { state, goAt } = running();
    const goneAt = goAt + 100;
    const gone = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goneAt,
      CYCLES,
    ).state;

    const early = apply(gone, { type: 'step' }, goneAt + 50, CYCLES);
    const last = apply(early.state, { type: 'step' }, goneAt + GRACE - 1, CYCLES);

    expect(early.state.phase).toBe('running');
    expect(last.state.phase).toBe('running');
    expect(cyclesOf(last.state).tick).toBe(cyclesOf(early.state).tick + 1);
  });

  it('ends it at the first command after the grace when nobody came back: the bots would play to an empty room', () => {
    const { state, goAt } = running();
    const goneAt = goAt + 100;
    const gone = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goneAt,
      CYCLES,
    ).state;

    const next = apply(gone, { type: 'tick' }, goneAt + GRACE, CYCLES);

    expect(next.state.phase).toBe('results');
    expect(next.state.round).toBeNull();
    expect(next.events).toEqual([{ type: 'phaseChanged', phase: 'results' }]);
    expect(cyclesOf(next.state).results).not.toBeNull();
  });

  it('goes on past the grace when they reconnected inside it', () => {
    const { state, goAt } = running();
    const goneAt = goAt + 100;
    let next = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goneAt,
      CYCLES,
    ).state;
    next = apply(
      next,
      { type: 'join', playerId: 'host', connectionId: 'c-again', name: 'Host' },
      goneAt + GRACE - 1,
      CYCLES,
    ).state;

    const later = apply(next, { type: 'tick' }, goneAt + 3 * GRACE, CYCLES);

    expect(later.state.phase).toBe('running');
  });

  it('waits for every person to be gone for the whole grace, not just one of them', () => {
    const { state, goAt } = running(true);
    let next = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 100,
      CYCLES,
    ).state;
    next = apply(
      next,
      { type: 'leave', playerId: 'guest', connectionId: 'c-guest' },
      goAt + 100 + GRACE - 5,
      CYCLES,
    ).state;

    expect(apply(next, { type: 'tick' }, goAt + 100 + GRACE, CYCLES).state.phase).toBe('running');
    expect(apply(next, { type: 'tick' }, goAt + 100 + GRACE - 5 + GRACE, CYCLES).state.phase).toBe(
      'results',
    );
  });

  it('lets it go on while a second person is connected, and takes the leaver off the field', () => {
    const { state, goAt } = running(true);
    const gone = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 100,
      CYCLES,
    ).state;

    const next = apply(gone, { type: 'step' }, goAt + 150, CYCLES).state;

    expect(next.phase).toBe('running');
    const cycles = cyclesOf(next);
    const hostSlot = cycles.index['1'] ?? -1;
    const bike = cycles.bikes[hostSlot];
    expect(bike?.alive).toBe(false);
    expect(bike?.trail.size).toBe(0);
    expect(cycles.field.includes(bike?.slot ?? 0)).toBe(false);
    expect(cycles.bikes.some((other) => other.alive)).toBe(true);
  });

  it('keeps the bike while another tab of the same person is open', () => {
    const { state, goAt } = running();
    const twoTabs = apply(
      state,
      { type: 'join', playerId: 'host', connectionId: 'c-second', name: 'Host' },
      goAt + 10,
      CYCLES,
    ).state;

    const one = apply(
      twoTabs,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 20,
      CYCLES,
    ).state;

    expect(cyclesOf(one).bikes[cyclesOf(one).index['1'] ?? -1]?.alive).toBe(true);
    expect(apply(one, { type: 'tick' }, goAt + 30, CYCLES).state.phase).toBe('running');
  });

  it('does not end a clicker round: its score is the point, with or without the player', () => {
    const started = run(lobbyWithHost(), [{ type: 'start', playerId: 'host' }]);
    const goAt = started.round?.goAt ?? 0;
    let state = apply(started, { type: 'tick' }, goAt).state;
    state = apply(
      state,
      { type: 'input', playerId: 'host', input: { type: 'click' } },
      goAt + 10,
    ).state;

    state = apply(
      state,
      { type: 'leave', playerId: 'host', connectionId: 'c-host' },
      goAt + 20,
    ).state;
    state = apply(state, { type: 'tick' }, goAt + 30).state;

    expect(state.phase).toBe('running');
    expect(clickerOf(state).scores['1']?.clicks).toBe(1);
  });
});

describe('the end of a living round', () => {
  it('puts the bots in the results under their own names', () => {
    const { state, goAt } = running();
    let next = state;
    for (let i = 0; i < 20; i += 1) {
      next = apply(next, { type: 'step' }, goAt + 50 * (i + 1), CYCLES).state;
    }

    const over = apply(next, { type: 'tick' }, goAt + CYCLES.roundMs + CYCLES.lateGraceMs, CYCLES);

    expect(over.state.phase).toBe('results');
    const rows = cyclesOf(over.state).results ?? [];
    expect(rows.map((row) => row.name).sort()).toEqual(['Bot 1', 'Bot 2', 'Host']);
  });
});
