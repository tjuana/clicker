import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState } from '../src/state';
import { config, deepFreeze } from './support';

describe('join', () => {
  it('adds a new player and answers with welcome', () => {
    const state = deepFreeze(createRoomState());

    const result = apply(
      state,
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      1000,
    );

    expect(result.state.players['secret-1']).toMatchObject({
      publicId: '1',
      name: 'Аня',
      connectionIds: ['conn-1'],
      clicks: 0,
      disconnectedAt: null,
    });
    expect(result.state.nextSeq).toBe(2);
    expect(result.events).toEqual([
      { type: 'welcome', playerId: 'secret-1', publicId: '1', isHost: false },
    ]);
  });

  it('does not mutate the input state', () => {
    const state = deepFreeze(createRoomState());

    apply(state, { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' }, 1000);

    expect(state.players).toEqual({});
    expect(state.nextSeq).toBe(1);
  });

  it('keeps two connection ids when a second tab joins', () => {
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      1000,
    );

    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-2', name: 'Аня' },
      2000,
    );

    expect(Object.keys(second.state.players)).toEqual(['secret-1']);
    expect(second.state.players['secret-1']?.connectionIds).toEqual(['conn-1', 'conn-2']);
    expect(second.state.players['secret-1']?.publicId).toBe('1');
  });

  it('remembers one connection however many joins arrive on it', () => {
    let state = createRoomState();
    for (let index = 0; index < 6; index += 1) {
      state = apply(
        deepFreeze(state),
        { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
        1000,
      ).state;
    }

    expect(state.players['secret-1']?.connectionIds).toEqual(['conn-1']);
  });

  it('drops a player after the grace period once the only connection leaves', () => {
    let state = createRoomState();
    for (let index = 0; index < 6; index += 1) {
      state = apply(
        state,
        { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
        1000,
      ).state;
    }

    const left = apply(
      state,
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      2000,
    );
    // reconnectGraceMs defaults to 30000.
    const expired = apply(left.state, { type: 'tick' }, 32000);

    expect(left.state.players['secret-1']?.disconnectedAt).toBe(2000);
    expect(expired.state.players).toEqual({});
  });

  it('keeps the player connected while the other tab is open', () => {
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      0,
    );
    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-2', name: 'Аня' },
      1000,
    );

    const left = apply(
      second.state,
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      2000,
    );

    expect(left.state.players['secret-1']).toMatchObject({
      connectionIds: ['conn-2'],
      disconnectedAt: null,
    });
  });

  it('keeps the score and clears disconnectedAt when a player comes back', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      0,
    );
    const left = apply(
      joined.state,
      { type: 'leave', playerId: 'secret-1', connectionId: 'conn-1' },
      1000,
    );

    const back = apply(
      left.state,
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-2', name: 'Аня Б' },
      2000,
    );

    expect(back.state.players['secret-1']).toMatchObject({
      name: 'Аня Б',
      connectionIds: ['conn-2'],
      disconnectedAt: null,
    });
  });

  it('rejects a new player when the room is full', () => {
    const full = config({ maxPlayers: 1 });
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня' },
      0,
      full,
    );

    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-2', connectionId: 'conn-2', name: 'Боря' },
      0,
      full,
    );

    expect(Object.keys(second.state.players)).toEqual(['secret-1']);
    expect(second.events).toEqual([{ type: 'rejected', playerId: 'secret-2', code: 'room_full' }]);
  });

  it('claims the host key on the first join that carries one', () => {
    const result = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    expect(result.state.hostKey).toBe('key-1');
    expect(result.state.hosts).toEqual(['secret-1']);
    expect(result.events).toEqual([
      { type: 'welcome', playerId: 'secret-1', publicId: '1', isHost: true },
    ]);
  });

  it('grants host to anyone who brings the same key, without duplicates', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    const secondDevice = apply(
      host.state,
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-2', name: 'Аня', hostKey: 'key-1' },
      1000,
    );

    expect(secondDevice.state.hosts).toEqual(['secret-1']);
  });

  it('lets a wrong key in as a regular player', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    const guest = apply(
      host.state,
      {
        type: 'join',
        playerId: 'secret-2',
        connectionId: 'conn-2',
        name: 'Боря',
        hostKey: 'wrong',
      },
      0,
    );

    expect(guest.state.hostKey).toBe('key-1');
    expect(guest.state.hosts).toEqual(['secret-1']);
    expect(guest.events).toEqual([
      { type: 'welcome', playerId: 'secret-2', publicId: '2', isHost: false },
    ]);
  });
});
