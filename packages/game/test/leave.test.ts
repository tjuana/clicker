import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState } from '../src/state';

function withPlayer() {
  return apply(createRoomState(), { type: 'join', playerId: 'secret-1', name: 'Аня' }, 0).state;
}

describe('leave', () => {
  it('marks the player as disconnected when the last connection closes', () => {
    const result = apply(withPlayer(), { type: 'leave', playerId: 'secret-1' }, 5000);

    expect(result.state.players['secret-1']).toMatchObject({
      connections: 0,
      disconnectedAt: 5000,
    });
  });

  it('keeps the player connected while another tab is open', () => {
    const twoTabs = apply(
      withPlayer(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      1000,
    ).state;

    const result = apply(twoTabs, { type: 'leave', playerId: 'secret-1' }, 5000);

    expect(result.state.players['secret-1']).toMatchObject({
      connections: 1,
      disconnectedAt: null,
    });
  });

  it('ignores an unknown player', () => {
    const state = withPlayer();

    const result = apply(state, { type: 'leave', playerId: 'nobody' }, 5000);

    expect(result.state.players).toEqual(state.players);
    expect(result.events).toEqual([]);
  });
});
