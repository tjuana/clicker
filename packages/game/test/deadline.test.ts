import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { nextDeadline } from '../src/deadline';
import { createRoomState } from '../src/state';
import { config } from './support';

const CONFIG = config({
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  reconnectGraceMs: 30000,
});

describe('nextDeadline', () => {
  it('has nothing to wait for in an empty lobby', () => {
    expect(nextDeadline(createRoomState(), CONFIG)).toBeNull();
  });

  it('waits for the go moment during the countdown', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
      CONFIG,
    );
    const started = apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);

    expect(nextDeadline(started.state, CONFIG)).toBe(4000);
  });

  it('waits for the end of the round plus the grace window', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
      CONFIG,
    );
    const started = apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);
    const running = apply(started.state, { type: 'tick' }, 4000, CONFIG);

    expect(nextDeadline(running.state, CONFIG)).toBe(14250);
  });

  it('waits to drop a disconnected player in the lobby', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const left = apply(joined.state, { type: 'leave', playerId: 'secret-1' }, 1000, CONFIG);

    expect(nextDeadline(left.state, CONFIG)).toBe(31000);
  });

  it('takes the earliest of several deadlines', () => {
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-2', name: 'Боря' },
      0,
      CONFIG,
    );
    const leftFirst = apply(second.state, { type: 'leave', playerId: 'secret-1' }, 1000, CONFIG);
    const leftSecond = apply(
      leftFirst.state,
      { type: 'leave', playerId: 'secret-2' },
      2000,
      CONFIG,
    );

    expect(nextDeadline(leftSecond.state, CONFIG)).toBe(31000);
  });
});
