import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState } from '../src/state';
import { config, deepFreeze } from './support';

describe('join', () => {
  it('adds a new player and answers with welcome', () => {
    const state = deepFreeze(createRoomState());

    const result = apply(state, { type: 'join', playerId: 'secret-1', name: 'Аня' }, 1000);

    expect(result.state.players['secret-1']).toMatchObject({
      publicId: '1',
      name: 'Аня',
      connections: 1,
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

    apply(state, { type: 'join', playerId: 'secret-1', name: 'Аня' }, 1000);

    expect(state.players).toEqual({});
    expect(state.nextSeq).toBe(1);
  });

  it('counts a second tab as one more connection of the same player', () => {
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      1000,
    );

    const second = apply(first.state, { type: 'join', playerId: 'secret-1', name: 'Аня' }, 2000);

    expect(Object.keys(second.state.players)).toEqual(['secret-1']);
    expect(second.state.players['secret-1']?.connections).toBe(2);
    expect(second.state.players['secret-1']?.publicId).toBe('1');
  });

  it('keeps the score and clears disconnectedAt when a player comes back', () => {
    const joined = apply(createRoomState(), { type: 'join', playerId: 'secret-1', name: 'Аня' }, 0);
    const left = apply(joined.state, { type: 'leave', playerId: 'secret-1' }, 1000);

    const back = apply(left.state, { type: 'join', playerId: 'secret-1', name: 'Аня Б' }, 2000);

    expect(back.state.players['secret-1']).toMatchObject({
      name: 'Аня Б',
      connections: 1,
      disconnectedAt: null,
    });
  });

  it('rejects a new player when the room is full', () => {
    const full = config({ maxPlayers: 1 });
    const first = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня' },
      0,
      full,
    );

    const second = apply(
      first.state,
      { type: 'join', playerId: 'secret-2', name: 'Боря' },
      0,
      full,
    );

    expect(Object.keys(second.state.players)).toEqual(['secret-1']);
    expect(second.events).toEqual([{ type: 'rejected', playerId: 'secret-2', code: 'room_full' }]);
  });

  it('claims the host key on the first join that carries one', () => {
    const result = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
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
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    const secondDevice = apply(
      host.state,
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      1000,
    );

    expect(secondDevice.state.hosts).toEqual(['secret-1']);
  });

  it('lets a wrong key in as a regular player', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );

    const guest = apply(
      host.state,
      { type: 'join', playerId: 'secret-2', name: 'Боря', hostKey: 'wrong' },
      0,
    );

    expect(guest.state.hostKey).toBe('key-1');
    expect(guest.state.hosts).toEqual(['secret-1']);
    expect(guest.events).toEqual([
      { type: 'welcome', playerId: 'secret-2', publicId: '2', isHost: false },
    ]);
  });
});
