import { describe, expect, it } from 'vitest';
import {
  CYCLES_CONFIG,
  cyclesConfigFor,
  DEFAULT_SPEED,
  SPEEDS,
  type Speed,
} from '../src/modes/cycles/config';
import { apply } from '../src/room/apply';
import { configFor, DEFAULT_CONFIG } from '../src/room/config';
import { abortRound, upgradeStored } from '../src/room/recovery';
import { createRoomState, type RoomState } from '../src/room/state';
import { cyclesOf, lobbyWithHost, run } from './support';

function cyclesLobby(): RoomState {
  return run(lobbyWithHost(), [{ type: 'setMode', playerId: 'host', mode: 'cycles' }]);
}

/** The host with one bot, the round started and running. */
function riding(speed: Speed): RoomState {
  const lobby = run(cyclesLobby(), [
    { type: 'setSpeed', playerId: 'host', speed },
    { type: 'addBot', playerId: 'host' },
    { type: 'start', playerId: 'host' },
  ]);
  return apply(lobby, { type: 'tick' }, lobby.round?.goAt ?? 0).state;
}

describe('the speeds a host can choose', () => {
  it('start at eight cells a second', () => {
    expect(DEFAULT_SPEED).toBe(8);
    expect(SPEEDS).toContain(DEFAULT_SPEED);
  });
});

describe('cyclesConfigFor', () => {
  it('lasts a boost one second, a respawn two and a cooldown four at any speed', () => {
    for (const speed of SPEEDS) {
      const config = cyclesConfigFor({ speed, walls: 'always' });
      expect(config.boostTicks).toBe(speed);
      expect(config.boostCooldownTicks).toBe(speed * 4);
      expect(config.respawnTicks).toBe(speed * 2);
      expect(config.rubberRegenTicks).toBe(speed);
    }
    expect(cyclesConfigFor({ speed: 8, walls: 'always' }).respawnTicks).toBe(16);
    expect(cyclesConfigFor({ speed: 20, walls: 'always' }).respawnTicks).toBe(40);
  });

  it('leaves everything that is not a duration as it is', () => {
    const { rubber, trail, killBonus, turnQueue } = CYCLES_CONFIG;
    expect(cyclesConfigFor({ speed: 8, walls: 'always' })).toMatchObject({
      rubber,
      trail,
      killBonus,
      turnQueue,
    });
  });

  it('is the existing twenty-cells-a-second config at twenty', () => {
    expect(cyclesConfigFor({ speed: 20, walls: 'always' })).toEqual(CYCLES_CONFIG);
  });
});

describe('configFor and the speed', () => {
  it('ticks the cycles once per cell: 125 ms at eight, 62.5 at sixteen', () => {
    expect(configFor('cycles', DEFAULT_CONFIG, 8).tickMs).toBe(125);
    expect(configFor('cycles', DEFAULT_CONFIG, 16).tickMs).toBe(62.5);
    expect(configFor('cycles', DEFAULT_CONFIG, 20).tickMs).toBe(50);
  });

  it('starts light-cycle rooms at the default speed', () => {
    expect(configFor('cycles').tickMs).toBe(1000 / DEFAULT_SPEED);
  });

  it('gives the clicker no tick whatever the speed', () => {
    expect(configFor('clicker', DEFAULT_CONFIG, 20).tickMs).toBeNull();
  });
});

describe('setSpeed', () => {
  it('starts a room at the default speed', () => {
    expect(createRoomState().settings.speed).toBe(DEFAULT_SPEED);
  });

  it('lets the host choose in the lobby', () => {
    const { state, events } = apply(
      cyclesLobby(),
      { type: 'setSpeed', playerId: 'host', speed: 16 },
      0,
    );

    expect(state.settings.speed).toBe(16);
    expect(events).toEqual([]);
  });

  it('lets the host choose again once the results are in', () => {
    const over = apply(riding(8), { type: 'tick' }, 10_000_000).state;
    expect(over.phase).toBe('results');

    expect(
      apply(over, { type: 'setSpeed', playerId: 'host', speed: 12 }, 10_000_000).state.settings
        .speed,
    ).toBe(12);
  });

  it('refuses a guest and a stranger', () => {
    const lobby = run(cyclesLobby(), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    ]);

    const guest = apply(lobby, { type: 'setSpeed', playerId: 'guest', speed: 20 }, 0);
    expect(guest.events).toEqual([{ type: 'rejected', playerId: 'guest', code: 'not_host' }]);
    expect(guest.state.settings.speed).toBe(DEFAULT_SPEED);

    const stranger = apply(lobby, { type: 'setSpeed', playerId: 'nobody', speed: 20 }, 0);
    expect(stranger.events).toEqual([{ type: 'rejected', playerId: 'nobody', code: 'not_joined' }]);
  });

  it.each(['countdown', 'running'] as const)('is refused during %s', (phase) => {
    const started = run(cyclesLobby(), [{ type: 'start', playerId: 'host' }]);
    const now = phase === 'running' ? (started.round?.goAt ?? 0) : 0;
    const live = apply(started, { type: 'tick' }, now).state;
    expect(live.phase).toBe(phase);

    const result = apply(live, { type: 'setSpeed', playerId: 'host', speed: 20 }, now);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'wrong_phase' }]);
    expect(result.state.settings.speed).toBe(live.settings.speed);
  });

  it('is not supported by the clicker', () => {
    const result = apply(lobbyWithHost(), { type: 'setSpeed', playerId: 'host', speed: 16 }, 0);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'not_supported' }]);
    expect(result.state.settings.speed).toBe(DEFAULT_SPEED);
  });

  it('survives a trip through the clicker and back', () => {
    const chosen = run(cyclesLobby(), [{ type: 'setSpeed', playerId: 'host', speed: 16 }]);

    const back = run(chosen, [
      { type: 'setMode', playerId: 'host', mode: 'clicker' },
      { type: 'setMode', playerId: 'host', mode: 'cycles' },
    ]);

    expect(back.settings.speed).toBe(16);
    expect(cyclesOf(back).bikes[0]?.respawnIn).toBe(32);
  });
});

describe('the rules at the chosen speed', () => {
  it.each<[Speed, number]>([
    [8, 16],
    [12, 24],
    [16, 32],
    [20, 40],
  ])('make a latecomer to a round at speed %i wait %i ticks', (speed, respawnTicks) => {
    const state = riding(speed);

    const joined = apply(
      state,
      { type: 'join', playerId: 'late', connectionId: 'c-late', name: 'Late' },
      state.round?.goAt ?? 0,
    ).state;

    const late = cyclesOf(joined).bikes.find((bike) => bike.publicId === '3');
    expect(late?.respawnIn).toBe(respawnTicks);
  });

  it('give a boost one second of ticks', () => {
    for (const speed of [8, 16] as const) {
      const state = riding(speed);
      const boosted = apply(
        state,
        { type: 'input', playerId: 'host', input: { type: 'boost' } },
        state.round?.goAt ?? 0,
      ).state;

      expect(cyclesOf(boosted).bikes[0]?.boost).toBe(speed);
    }
  });

  it('send an interrupted round back to a lobby at the same speed', () => {
    const aborted = abortRound(riding(16));

    expect(aborted.phase).toBe('lobby');
    expect(cyclesOf(aborted).bikes[0]?.respawnIn).toBe(32);
  });
});

describe('a room stored before the speed existed', () => {
  it('reads as the default speed', () => {
    const { settings: _settings, ...legacy } = cyclesLobby();

    const synced = upgradeStored(legacy as unknown as RoomState);

    expect(synced.settings.speed).toBe(DEFAULT_SPEED);
  });

  it('keeps a speed that was stored', () => {
    const stored = run(cyclesLobby(), [{ type: 'setSpeed', playerId: 'host', speed: 12 }]);

    expect(upgradeStored(stored).settings.speed).toBe(12);
  });
});
