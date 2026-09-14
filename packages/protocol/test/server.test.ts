import { apply, createRoomState, type RoomState } from '@clicker/game';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/client';
import { MAX_SERVER_MESSAGE_BYTES, parseServerMessage, toSnapshot } from '../src/server';

/** Host "secret-1" and player "secret-2", round already played out. */
function playedRoom(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
    0,
  );
  const guest = apply(
    host.state,
    { type: 'join', playerId: 'secret-2', connectionId: 'conn-2', name: 'Боря' },
    0,
  );
  const started = apply(guest.state, { type: 'start', playerId: 'secret-1' }, 1000);
  const clicked = apply(
    started.state,
    { type: 'input', playerId: 'secret-2', input: { type: 'click' } },
    5000,
  );
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
        {
          type: 'join',
          playerId: `secret-${index}`,
          connectionId: `conn-${index}`,
          name: `p${index}`,
        },
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
    expect(snapshot.data.results).toEqual([
      { id: '2', name: 'Боря', clicks: 1, rank: 1 },
      { id: '1', name: 'Аня', clicks: 0, rank: 2 },
    ]);
  });

  it('reports the live round while it is on', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );
    const started = apply(host.state, { type: 'start', playerId: 'secret-1' }, 1000);

    const snapshot = toSnapshot(started.state, 1000);

    expect(snapshot.phase).toBe('countdown');
    expect(snapshot.round).toEqual({ goAt: 4000, endsAt: 14000 });
    expect(snapshot.data.results).toBeNull();
    expect(snapshot.notice).toBeNull();
  });

  it('passes its own schema', () => {
    const snapshot = toSnapshot(playedRoom(), 42);

    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('parseServerMessage', () => {
  it('accepts welcome and error', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ v: PROTOCOL_VERSION, type: 'welcome', you: '1', isHost: true }),
      ),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'welcome',
      you: '1',
      isHost: true,
    });
    expect(
      parseServerMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', code: 'not_host' })),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'error',
      code: 'not_host',
    });
  });

  it('rejects an unknown error code', () => {
    expect(
      parseServerMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', code: 'nope' })),
    ).toBeNull();
  });

  it('rejects a message over the server byte limit', () => {
    const raw = `"${'x'.repeat(MAX_SERVER_MESSAGE_BYTES)}"`;

    expect(parseServerMessage(raw)).toBeNull();
  });
});
