import { describe, expect, it } from 'vitest';
import { emptyScore } from '../src/modes/clicker/state';
import { advance } from '../src/room/advance';
import { apply } from '../src/room/apply';
import type { RoomState } from '../src/room/state';
import { config, deepFreeze, player, room } from './support';

const CONFIG = config({
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  reconnectGraceMs: 30000,
});

/** Countdown is in progress: the round opens at 4000, closes at 14000. */
function countdown(): RoomState {
  return room({
    phase: 'countdown',
    hostKey: 'key-1',
    hosts: ['secret-1'],
    players: { 'secret-1': player({ publicId: '1', name: 'Аня' }) },
    nextSeq: 2,
    round: { goAt: 4000, endsAt: 14000 },
    modeState: { scores: { '1': emptyScore(0, CONFIG.burst) }, results: null },
  });
}

describe('advance', () => {
  it('waits while the countdown is still running', () => {
    const result = advance(deepFreeze(countdown()), 3999, CONFIG);

    expect(result.state.phase).toBe('countdown');
    expect(result.phases).toEqual([]);
  });

  it('opens the round when the countdown is over', () => {
    const result = advance(deepFreeze(countdown()), 4000, CONFIG);

    expect(result.state.phase).toBe('running');
    expect(result.phases).toEqual(['running']);
  });

  it('keeps the round open inside the grace window', () => {
    const running = deepFreeze<RoomState>({ ...countdown(), phase: 'running' });

    const result = advance(running, 14249, CONFIG);

    expect(result.state.phase).toBe('running');
    expect(result.phases).toEqual([]);
  });

  it('closes the round after the grace window and fills the results', () => {
    const running = deepFreeze<RoomState>({ ...countdown(), phase: 'running' });

    const result = advance(running, 14250, CONFIG);

    expect(result.state.phase).toBe('results');
    expect(result.state.round).toBeNull();
    expect(result.state.modeState.results).toEqual([
      { publicId: '1', name: 'Аня', clicks: 0, rank: 1 },
    ]);
    expect(result.phases).toEqual(['results']);
  });

  it('walks through both transitions when the alarm is late', () => {
    const result = advance(deepFreeze(countdown()), 20000, CONFIG);

    expect(result.state.phase).toBe('results');
    expect(result.phases).toEqual(['running', 'results']);
  });

  it('drops a disconnected player from the lobby after the grace period', () => {
    const state = deepFreeze(
      room({
        hosts: ['secret-1'],
        players: { 'secret-1': player({ publicId: '1', connectionIds: [], disconnectedAt: 1000 }) },
      }),
    );

    const before = advance(state, 30999, CONFIG);
    const after = advance(state, 31000, CONFIG);

    expect(Object.keys(before.state.players)).toEqual(['secret-1']);
    expect(after.state.players).toEqual({});
    expect(after.state.hosts).toEqual([]);
  });

  it('keeps a disconnected player while the round is on', () => {
    const state = deepFreeze(
      room({
        phase: 'running',
        round: { goAt: 4000, endsAt: 14000 },
        players: { 'secret-1': player({ publicId: '1', connectionIds: [], disconnectedAt: 1000 }) },
      }),
    );

    const result = advance(state, 13000, CONFIG);

    expect(Object.keys(result.state.players)).toEqual(['secret-1']);
  });
});

describe('apply', () => {
  it('reports the phases it walked through before handling the command', () => {
    const result = apply(
      deepFreeze(countdown()),
      { type: 'input', playerId: 'nobody', input: { type: 'click' } },
      4000,
      CONFIG,
    );

    expect(result.events).toEqual([
      { type: 'phaseChanged', phase: 'running' },
      { type: 'rejected', playerId: 'nobody', code: 'not_joined' },
    ]);
  });
});
