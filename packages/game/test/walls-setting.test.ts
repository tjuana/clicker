import { describe, expect, it } from 'vitest';
import {
  CYCLES_CONFIG,
  cyclesConfigFor,
  DEFAULT_CYCLES_SETTINGS,
  WALL_MODES,
} from '../src/modes/cycles/config';
import { apply } from '../src/room/apply';
import { syncConnections } from '../src/room/recovery';
import { createRoomState, type RoomState } from '../src/room/state';
import { lobbyWithHost, run } from './support';

function cyclesLobby(): RoomState {
  return run(lobbyWithHost(), [{ type: 'setMode', playerId: 'host', mode: 'cycles' }]);
}

describe('the walls a host can choose', () => {
  it('start as they always were', () => {
    expect(DEFAULT_CYCLES_SETTINGS).toEqual({ speed: 8, walls: 'always' });
    expect(WALL_MODES).toEqual(['always', 'button']);
    expect(createRoomState().settings).toEqual(DEFAULT_CYCLES_SETTINGS);
  });
});

describe('the energy of a wall on a key', () => {
  it('is designed in seconds: four to start, eight at most, one back per kill', () => {
    for (const speed of [8, 12, 16, 20] as const) {
      const config = cyclesConfigFor({ speed, walls: 'button' });
      expect(config.walls).toBe('button');
      expect(config.energyTicks).toBe(speed * 4);
      expect(config.energyMaxTicks).toBe(speed * 8);
      expect(config.energyKillTicks).toBe(speed);
      expect(config.energyRegenTicks).toBe(2);
    }
  });

  it('is 80, 160, 20 and 2 at twenty cells a second', () => {
    expect(CYCLES_CONFIG).toMatchObject({
      walls: 'always',
      energyTicks: 80,
      energyMaxTicks: 160,
      energyKillTicks: 20,
      energyRegenTicks: 2,
    });
    expect(cyclesConfigFor({ speed: 20, walls: 'always' })).toEqual(CYCLES_CONFIG);
  });
});

describe('setWalls', () => {
  it('lets the host choose in the lobby', () => {
    const { state, events } = apply(
      cyclesLobby(),
      { type: 'setWalls', playerId: 'host', walls: 'button' },
      0,
    );

    expect(state.settings.walls).toBe('button');
    expect(state.settings.speed).toBe(8);
    expect(events).toEqual([]);
  });

  it('keeps the speed the host chose, and the other way round', () => {
    const state = run(cyclesLobby(), [
      { type: 'setSpeed', playerId: 'host', speed: 16 },
      { type: 'setWalls', playerId: 'host', walls: 'button' },
    ]);

    expect(state.settings).toEqual({ speed: 16, walls: 'button' });
  });

  it('lets the host choose again once the results are in', () => {
    const started = run(cyclesLobby(), [
      { type: 'addBot', playerId: 'host' },
      { type: 'start', playerId: 'host' },
    ]);
    const over = apply(
      apply(started, { type: 'tick' }, started.round?.goAt ?? 0).state,
      { type: 'tick' },
      10_000_000,
    ).state;
    expect(over.phase).toBe('results');

    const chosen = apply(over, { type: 'setWalls', playerId: 'host', walls: 'button' }, 10_000_000);

    expect(chosen.state.settings.walls).toBe('button');
  });

  it('refuses a guest', () => {
    const lobby = run(cyclesLobby(), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    ]);

    const guest = apply(lobby, { type: 'setWalls', playerId: 'guest', walls: 'button' }, 0);

    expect(guest.events).toEqual([{ type: 'rejected', playerId: 'guest', code: 'not_host' }]);
    expect(guest.state.settings.walls).toBe('always');
  });

  it.each(['countdown', 'running'] as const)('is refused during %s', (phase) => {
    const started = run(cyclesLobby(), [{ type: 'start', playerId: 'host' }]);
    const now = phase === 'running' ? (started.round?.goAt ?? 0) : 0;
    const live = apply(started, { type: 'tick' }, now).state;
    expect(live.phase).toBe(phase);

    const result = apply(live, { type: 'setWalls', playerId: 'host', walls: 'button' }, now);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'wrong_phase' }]);
    expect(result.state.settings.walls).toBe('always');
  });

  it('is not supported by the clicker', () => {
    const result = apply(
      lobbyWithHost(),
      { type: 'setWalls', playerId: 'host', walls: 'button' },
      0,
    );

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'not_supported' }]);
    expect(result.state.settings.walls).toBe('always');
  });

  it('changes nothing when the host chooses what is already chosen', () => {
    const lobby = cyclesLobby();

    const result = apply(lobby, { type: 'setWalls', playerId: 'host', walls: 'always' }, 0);

    expect(result.state).toBe(lobby);
  });

  it('survives a trip through the clicker and back', () => {
    const chosen = run(cyclesLobby(), [{ type: 'setWalls', playerId: 'host', walls: 'button' }]);

    const back = run(chosen, [
      { type: 'setMode', playerId: 'host', mode: 'clicker' },
      { type: 'setMode', playerId: 'host', mode: 'cycles' },
    ]);

    expect(back.settings.walls).toBe('button');
  });
});

describe('a room stored before the walls existed', () => {
  it('keeps the speed it had and lays its walls as ever', () => {
    const { settings: _settings, ...legacy } = cyclesLobby();

    const synced = syncConnections(
      { ...legacy, speed: 12 } as unknown as RoomState,
      { host: ['c-host'] },
      0,
    );

    expect(synced.settings).toEqual({ speed: 12, walls: 'always' });
  });

  it('reads as the defaults when it had no speed either', () => {
    const { settings: _settings, ...legacy } = cyclesLobby();

    const synced = syncConnections(legacy as unknown as RoomState, { host: ['c-host'] }, 0);

    expect(synced.settings).toEqual(DEFAULT_CYCLES_SETTINGS);
  });

  it('keeps settings that were stored', () => {
    const stored = run(cyclesLobby(), [{ type: 'setWalls', playerId: 'host', walls: 'button' }]);

    expect(syncConnections(stored, { host: ['c-host'] }, 0).settings.walls).toBe('button');
  });
});
