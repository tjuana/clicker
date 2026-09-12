import { describe, expect, it } from 'vitest';
import { createRoomState } from '../src/state';

describe('createRoomState', () => {
  it('starts in an empty lobby', () => {
    expect(createRoomState()).toEqual({
      phase: 'lobby',
      hostKey: null,
      hosts: [],
      players: {},
      nextSeq: 1,
      round: null,
      results: null,
      notice: null,
    });
  });
});
