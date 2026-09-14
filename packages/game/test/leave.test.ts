import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { nextDeadline } from '../src/room/deadline';
import { createRoomState } from '../src/room/state';
import { deepFreeze } from './support';

function withPlayer() {
  return apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
    0,
  ).state;
}

describe('leave', () => {
  it('marks the player as disconnected when the last connection closes', () => {
    const result = apply(
      deepFreeze(withPlayer()),
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      5000,
    );

    expect(result.state.players['secret-1']).toMatchObject({
      connectionIds: [],
      disconnectedAt: 5000,
    });
  });

  it('keeps the player connected while another tab is open', () => {
    const twoTabs = apply(
      withPlayer(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-2', name: 'Аня' },
      1000,
    ).state;

    const result = apply(
      deepFreeze(twoTabs),
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      5000,
    );

    expect(result.state.players['secret-1']).toMatchObject({
      connectionIds: ['conn-2'],
      disconnectedAt: null,
    });
  });

  it('ignores a repeated leave of the same connection and keeps the deadline', () => {
    const left = apply(
      withPlayer(),
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      5000,
    ).state;
    const deadline = nextDeadline(left);

    const again = apply(
      deepFreeze(left),
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      9000,
    );

    expect(again.state.players['secret-1']).toMatchObject({
      connectionIds: [],
      disconnectedAt: 5000,
    });
    expect(nextDeadline(again.state)).toBe(deadline);
  });

  it('ignores a leave from a connection the player never had', () => {
    const state = deepFreeze(withPlayer());

    const result = apply(
      state,
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-9' },
      5000,
    );

    expect(result.state).toBe(state);
    expect(result.state.players['secret-1']).toMatchObject({
      connectionIds: ['conn-1'],
      disconnectedAt: null,
    });
  });

  it('ignores an unknown player', () => {
    const state = deepFreeze(withPlayer());

    const result = apply(
      state,
      { type: 'leave', playerId: 'nobody', connectionId: 'conn-1' },
      5000,
    );

    expect(result.state.players).toEqual(state.players);
    expect(result.events).toEqual([]);
  });
});
