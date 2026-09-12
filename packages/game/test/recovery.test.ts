import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { abortRound, syncConnections } from '../src/recovery';
import { createRoomState, type RoomState } from '../src/state';
import { config, deepFreeze } from './support';

const CONFIG = config({ countdownMs: 3000, roundMs: 10000 });

function running(): RoomState {
  const joined = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
    0,
    CONFIG,
  );
  const started = apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);
  return apply(started.state, { type: 'tick' }, 4000, CONFIG).state;
}

describe('abortRound', () => {
  it('returns everybody to the lobby with a notice', () => {
    const state = deepFreeze(running());

    const aborted = abortRound(state);

    expect(aborted.phase).toBe('lobby');
    expect(aborted.round).toBeNull();
    expect(aborted.notice).toBe('round_aborted');
    expect(state.phase).toBe('running');
  });
});

describe('syncConnections', () => {
  it('marks a player without live connections as disconnected', () => {
    const state = deepFreeze(running());

    const synced = syncConnections(state, {}, 9000);

    expect(synced.players['secret-1']).toMatchObject({ connectionIds: [], disconnectedAt: 9000 });
  });

  it('keeps the earlier disconnect time', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const left = apply(
      joined.state,
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      1000,
      CONFIG,
    );

    const synced = syncConnections(left.state, {}, 9000);

    expect(synced.players['secret-1']?.disconnectedAt).toBe(1000);
  });

  it('restores a player who has live connections', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      0,
      CONFIG,
    );
    const left = apply(
      joined.state,
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      1000,
      CONFIG,
    );

    const synced = syncConnections(left.state, { 'secret-1': ['conn-2', 'conn-3'] }, 9000);

    expect(synced.players['secret-1']).toMatchObject({
      connectionIds: ['conn-2', 'conn-3'],
      disconnectedAt: null,
    });
  });
});
