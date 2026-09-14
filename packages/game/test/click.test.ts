import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { createRoomState, type RoomState } from '../src/room/state';
import { config, deepFreeze } from './support';

const CONFIG = config({ countdownMs: 3000, roundMs: 10000, burst: 15, clicksPerSecond: 15 });
const GO_AT = 4000;
const ENDS_AT = 14000;

/** Host is in the room, the round started at 1000: countdown to 4000, ends at 14000. */
function started(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
    0,
    CONFIG,
  );
  return apply(host.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG).state;
}

function clickTimes(state: RoomState, times: number[]): RoomState {
  let next = state;
  for (const time of times) {
    next = apply(
      deepFreeze(next),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      time,
      CONFIG,
    ).state;
  }
  return next;
}

/** The bucket is empty, the anchor is GO_AT. */
function drained(): RoomState {
  return clickTimes(
    started(),
    Array.from({ length: CONFIG.burst }, () => GO_AT),
  );
}

describe('click', () => {
  it('is ignored during the countdown, without an error', () => {
    const result = apply(
      deepFreeze(started()),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      2000,
      CONFIG,
    );

    expect(result.state.modeState.scores['1']?.clicks).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('counts a click inside the round', () => {
    const result = apply(
      deepFreeze(started()),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      GO_AT,
      CONFIG,
    );

    expect(result.state.phase).toBe('running');
    expect(result.state.modeState.scores['1']).toMatchObject({ clicks: 1, lastCountedAt: GO_AT });
  });

  it('counts a click that arrives inside the late grace window', () => {
    const result = apply(
      deepFreeze(started()),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      ENDS_AT + 249,
      CONFIG,
    );

    expect(result.state.modeState.scores['1']?.clicks).toBe(1);
  });

  it('ignores a click that arrives after the grace window', () => {
    const result = apply(
      deepFreeze(started()),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      ENDS_AT + 250,
      CONFIG,
    );

    expect(result.state.phase).toBe('results');
    expect(result.state.modeState.results?.[0]?.clicks).toBe(0);
  });

  it('lets a burst of 15 clicks through at the same instant and stops the 16th', () => {
    const times = Array.from({ length: 16 }, () => GO_AT);

    const state = clickTimes(started(), times);

    expect(state.modeState.scores['1']?.clicks).toBe(15);
  });

  it('refills the bucket over time', () => {
    const later = apply(
      deepFreeze(drained()),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      GO_AT + 100,
      CONFIG,
    );

    expect(later.state.modeState.scores['1']?.clicks).toBe(16);
  });

  it('refills at 15 clicks per second, no faster', () => {
    const spent = deepFreeze(drained());

    const tooSoon = apply(
      spent,
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      GO_AT + 66,
      CONFIG,
    );
    const inTime = apply(
      spent,
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      GO_AT + 67,
      CONFIG,
    );

    expect(tooSoon.state.modeState.scores['1']?.clicks).toBe(CONFIG.burst);
    expect(inTime.state.modeState.scores['1']?.clicks).toBe(CONFIG.burst + 1);
  });

  it('returns the state untouched when the click is refused', () => {
    const spent = deepFreeze(drained());

    const result = apply(
      spent,
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      GO_AT,
      CONFIG,
    );

    expect(result.state).toBe(spent);
    expect(result.events).toEqual([]);
  });

  it('does not let a click stamped in the past rewind the bucket anchor', () => {
    const spent = drained();
    expect(spent.modeState.scores['1']?.clicks).toBe(CONFIG.burst);

    // A message timestamped in the past: the anchor must not move backwards.
    const past = apply(
      deepFreeze(spent),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      GO_AT - 1000,
      CONFIG,
    );
    const after = clickTimes(
      past.state,
      Array.from({ length: CONFIG.burst }, () => GO_AT + 1),
    );

    expect(after.modeState.scores['1']?.clicks).toBe(CONFIG.burst);
  });

  it('gives no more than a burst to a player who idled for ten seconds', () => {
    // The bucket never refills past capacity, no matter how long the player waited.
    const state = clickTimes(
      drained(),
      Array.from({ length: CONFIG.burst + 1 }, () => GO_AT + 10_000),
    );

    expect(state.modeState.scores['1']?.clicks).toBe(CONFIG.burst * 2);
  });

  it('refuses a click from an unknown player', () => {
    const running = apply(deepFreeze(started()), { type: 'tick' }, GO_AT, CONFIG).state;

    const result = apply(
      running,
      { type: 'input', playerId: 'nobody', input: { type: 'click' } },
      GO_AT + 10,
      CONFIG,
    );

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'nobody', code: 'not_joined' }]);
  });
});
