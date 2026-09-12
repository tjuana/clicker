import { describe, expect, it } from 'vitest';
import { apply } from '../src/apply';
import { createRoomState, type RoomState } from '../src/state';
import { config, deepFreeze } from './support';

const CONFIG = config({ countdownMs: 3000, roundMs: 10000 });

/** Хост «secret-1» и обычный игрок «secret-2» в лобби. */
function lobby(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
    0,
    CONFIG,
  );
  return apply(
    host.state,
    { type: 'join', playerId: 'secret-2', connectionId: 'conn-2', name: 'Боря' },
    0,
    CONFIG,
  ).state;
}

describe('start', () => {
  it('opens the countdown and plans the round', () => {
    const result = apply(
      deepFreeze(lobby()),
      { type: 'start', playerId: 'secret-1' },
      1000,
      CONFIG,
    );

    expect(result.state.phase).toBe('countdown');
    expect(result.state.round).toEqual({ goAt: 4000, endsAt: 14000 });
    expect(result.events).toEqual([{ type: 'phaseChanged', phase: 'countdown' }]);
  });

  it('resets scores and refills the buckets from the go moment', () => {
    const played: RoomState = {
      ...lobby(),
      phase: 'results',
      results: [],
    };
    const scored = deepFreeze<RoomState>({
      ...played,
      players: {
        ...played.players,
        'secret-1': {
          ...(played.players['secret-1'] as NonNullable<(typeof played.players)['secret-1']>),
          clicks: 42,
          lastCountedAt: 900,
        },
      },
    });

    const result = apply(scored, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG);

    expect(result.state.players['secret-1']).toMatchObject({
      clicks: 0,
      lastCountedAt: null,
      bucket: { tokens: CONFIG.burst, updatedAt: 4000 },
    });
    expect(result.state.results).toBeNull();
  });

  it('refuses a player who is not the host', () => {
    const result = apply(
      deepFreeze(lobby()),
      { type: 'start', playerId: 'secret-2' },
      1000,
      CONFIG,
    );

    expect(result.state.phase).toBe('lobby');
    expect(result.events).toEqual([{ type: 'rejected', playerId: 'secret-2', code: 'not_host' }]);
  });

  it('refuses an unknown player', () => {
    const result = apply(deepFreeze(lobby()), { type: 'start', playerId: 'nobody' }, 1000, CONFIG);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'nobody', code: 'not_joined' }]);
  });

  it('refuses a second start while the round is on', () => {
    const started = apply(
      deepFreeze(lobby()),
      { type: 'start', playerId: 'secret-1' },
      1000,
      CONFIG,
    );

    const again = apply(
      deepFreeze(started.state),
      { type: 'start', playerId: 'secret-1' },
      2000,
      CONFIG,
    );

    expect(again.events).toEqual([{ type: 'rejected', playerId: 'secret-1', code: 'wrong_phase' }]);
  });

  it('allows the next round straight from the results screen', () => {
    const started = apply(
      deepFreeze(lobby()),
      { type: 'start', playerId: 'secret-1' },
      1000,
      CONFIG,
    );
    const finished = apply(deepFreeze(started.state), { type: 'tick' }, 14250, CONFIG);
    expect(finished.state.phase).toBe('results');

    const again = apply(
      deepFreeze(finished.state),
      { type: 'start', playerId: 'secret-1' },
      15000,
      CONFIG,
    );

    expect(again.state.phase).toBe('countdown');
    expect(again.state.round).toEqual({ goAt: 18000, endsAt: 28000 });
  });
});
