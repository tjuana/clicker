import { describe, expect, it } from 'vitest';
import { createRoomState } from '../src/room/state';

describe('createRoomState', () => {
  it('starts in an empty lobby', () => {
    expect(createRoomState()).toEqual({
      mode: 'clicker',
      phase: 'lobby',
      hostKey: null,
      hosts: [],
      players: {},
      nextSeq: 1,
      round: null,
      notice: null,
      modeState: { scores: {}, results: null },
    });
  });
});
