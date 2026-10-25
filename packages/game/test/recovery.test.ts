import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { abortRound, syncConnections, upgradeStored } from '../src/room/recovery';
import { createRoomState, type Player, type RoomState } from '../src/room/state';
import { clickerOf, config, cyclesOf, deepFreeze, lobbyWithHost, run } from './support';

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

  it('aborts a countdown as well', () => {
    const joined = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
      0,
      CONFIG,
    );
    const state = deepFreeze(
      apply(joined.state, { type: 'start', playerId: 'secret-1' }, 1000, CONFIG).state,
    );
    expect(state.phase).toBe('countdown');

    const aborted = abortRound(state);

    expect(aborted.phase).toBe('lobby');
    expect(aborted.notice).toBe('round_aborted');
  });

  it('clears the scores of the aborted round', () => {
    const clicked = apply(
      running(),
      { type: 'input', playerId: 'secret-1', input: { type: 'click' } },
      5000,
      CONFIG,
    ).state;
    expect(clickerOf(clicked).scores['1']).toMatchObject({ clicks: 1, lastCountedAt: 5000 });

    const aborted = abortRound(deepFreeze(clicked));

    expect(clickerOf(aborted).scores['1']).toMatchObject({ clicks: 0, lastCountedAt: null });
  });

  it('leaves a room that is not in a round untouched', () => {
    const lobby = deepFreeze(createRoomState());
    const results = deepFreeze<RoomState>({
      ...createRoomState(),
      phase: 'results',
      modeState: { scores: {}, results: [{ publicId: '1', name: 'Аня', clicks: 7, rank: 1 }] },
    });

    expect(abortRound(lobby)).toBe(lobby);
    expect(abortRound(results)).toBe(results);
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

  // Rooms stored before the bot flag existed hold players without it.
  it('gives a player stored without the bot flag a false one', () => {
    const { bot: _bot, ...legacy } = running().players['secret-1'] as Player;
    const stored = { ...running(), players: { 'secret-1': legacy as Player } };

    const synced = syncConnections(upgradeStored(stored), { 'secret-1': ['conn-2'] }, 9000);

    expect(synced.players['secret-1']?.bot).toBe(false);
  });
});

describe('a light-cycle room stored mid-round by the build before', () => {
  it('goes through the start-up in the order the server runs it and comes out a lobby', () => {
    const riding = run(lobbyWithHost(), [
      { type: 'setMode', playerId: 'host', mode: 'cycles' },
      { type: 'addBot', playerId: 'host' },
      { type: 'start', playerId: 'host' },
    ]);
    const { settings: _settings, ...modern } = apply(
      riding,
      { type: 'tick' },
      riding.round?.goAt ?? 0,
    ).state;
    // The old build kept the speed on the room and gave its bikes no wall fields.
    const bikes = cyclesOf(modern as RoomState).bikes.map(
      ({ held: _h, lit: _l, energy: _e, energyCap: _c, energyRegen: _r, ...bike }) => bike,
    );
    const stored = {
      ...modern,
      speed: 8,
      modeState: { ...(modern.modeState as object), bikes },
    } as unknown as RoomState;
    expect(stored.phase).toBe('running');

    const upgraded = upgradeStored(stored);
    const synced = syncConnections(abortRound(upgraded), { host: ['c-host'] }, 0);

    expect(synced.settings).toEqual({ speed: 8, walls: 'always' });
    expect(synced.phase).toBe('lobby');
  });
});
