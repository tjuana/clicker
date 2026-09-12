import { apply, createRoomState, type RoomState } from '@clicker/game';
import { describe, expect, it } from 'vitest';
import { parseServerMessage, toSnapshot } from '../src/server';

/** Хост «secret-1» и игрок «secret-2», раунд отыгран. */
function playedRoom(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
    0,
  );
  const guest = apply(host.state, { type: 'join', playerId: 'secret-2', name: 'Боря' }, 0);
  const started = apply(guest.state, { type: 'start', playerId: 'secret-1' }, 1000);
  const clicked = apply(started.state, { type: 'click', playerId: 'secret-2' }, 5000);
  return apply(clicked.state, { type: 'tick' }, 999_999).state;
}

describe('toSnapshot', () => {
  it('shows public ids and hides the secrets', () => {
    const snapshot = toSnapshot(playedRoom(), 5000);
    const json = JSON.stringify(snapshot);

    expect(snapshot.players.map((player) => player.id)).toEqual(['1', '2']);
    expect(json).not.toContain('secret-1');
    expect(json).not.toContain('key-1');
  });

  it('sorts players by id as numbers', () => {
    let state = createRoomState();
    for (let index = 1; index <= 12; index += 1) {
      state = apply(
        state,
        { type: 'join', playerId: `secret-${index}`, name: `p${index}` },
        0,
      ).state;
    }
    const reversed: RoomState = {
      ...state,
      players: Object.fromEntries(Object.entries(state.players).reverse()),
    };

    const snapshot = toSnapshot(reversed, 0);

    expect(snapshot.players.map((player) => player.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
  });

  it('carries the results of the finished round', () => {
    const snapshot = toSnapshot(playedRoom(), 999_999);

    expect(snapshot.phase).toBe('results');
    expect(snapshot.round).toBeNull();
    expect(snapshot.results).toEqual([
      { id: '2', name: 'Боря', clicks: 1, rank: 1 },
      { id: '1', name: 'Аня', clicks: 0, rank: 2 },
    ]);
  });

  it('reports the live round while it is on', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );
    const started = apply(host.state, { type: 'start', playerId: 'secret-1' }, 1000);

    const snapshot = toSnapshot(started.state, 1000);

    expect(snapshot.phase).toBe('countdown');
    expect(snapshot.round).toEqual({ goAt: 4000, endsAt: 14000 });
    expect(snapshot.results).toBeNull();
    expect(snapshot.notice).toBeNull();
  });

  it('passes its own schema', () => {
    const snapshot = toSnapshot(playedRoom(), 42);

    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('parseServerMessage', () => {
  it('accepts welcome and error', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'welcome', you: '1', isHost: true }))).toEqual(
      {
        type: 'welcome',
        you: '1',
        isHost: true,
      },
    );
    expect(parseServerMessage(JSON.stringify({ type: 'error', code: 'not_host' }))).toEqual({
      type: 'error',
      code: 'not_host',
    });
  });

  it('rejects an unknown error code', () => {
    expect(parseServerMessage(JSON.stringify({ type: 'error', code: 'nope' }))).toBeNull();
  });
});
