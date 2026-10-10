import { describe, expect, it } from 'vitest';
import { apply } from '../src/room/apply';
import { configFor } from '../src/room/config';
import { syncConnections } from '../src/room/recovery';
import { cyclesOf, deepFreeze, lobbyWithHost, run } from './support';

const CYCLES = configFor('cycles');

function cyclesLobby() {
  return run(lobbyWithHost(), [{ type: 'setMode', playerId: 'host', mode: 'cycles' }]);
}

function withBots(count: number) {
  let state = cyclesLobby();
  for (let i = 0; i < count; i += 1) {
    state = apply(state, { type: 'addBot', playerId: 'host' }, 0, CYCLES).state;
  }
  return state;
}

describe('addBot', () => {
  it('seats a bot that looks like any other player, named Bot 1, then Bot 2', () => {
    const state = withBots(2);

    const bots = Object.values(state.players).filter((p) => p.bot);
    expect(bots.map((b) => b.name)).toEqual(['Bot 1', 'Bot 2']);
    expect(bots.map((b) => b.publicId)).toEqual(['2', '3']);
    for (const bot of bots) {
      expect(bot).toMatchObject({ connectionIds: [], disconnectedAt: null, bot: true });
    }
    expect(state.players.host?.bot).toBe(false);
  });

  it('puts the bot on the field as a bot', () => {
    const state = withBots(1);

    const bike = cyclesOf(state).bikes.find((b) => b.publicId === '2');
    expect(bike?.bot).toBe(true);
  });

  it('is refused in a mode without bots', () => {
    const lobby = deepFreeze(lobbyWithHost());

    const result = apply(lobby, { type: 'addBot', playerId: 'host' }, 0);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'not_supported' }]);
    expect(result.state).toBe(lobby);
  });

  it('is refused for a guest and during a round', () => {
    const lobby = run(cyclesLobby(), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    ]);
    expect(apply(lobby, { type: 'addBot', playerId: 'guest' }, 0, CYCLES).events).toEqual([
      { type: 'rejected', playerId: 'guest', code: 'not_host' },
    ]);

    const started = apply(lobby, { type: 'start', playerId: 'host' }, 0, CYCLES).state;
    expect(apply(started, { type: 'addBot', playerId: 'host' }, 0, CYCLES).events).toEqual([
      { type: 'rejected', playerId: 'host', code: 'wrong_phase' },
    ]);
  });

  it('stops at twenty participants, people and bots together', () => {
    const full = withBots(19);
    expect(Object.keys(full.players)).toHaveLength(20);

    const result = apply(full, { type: 'addBot', playerId: 'host' }, 0, CYCLES);

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'host', code: 'room_full' }]);
    expect(result.state).toBe(full);
  });

  it('counts the bots against the room when a person tries to join', () => {
    const full = withBots(19);

    const result = apply(
      full,
      { type: 'join', playerId: 'late', connectionId: 'c-late', name: 'Late' },
      0,
      CYCLES,
    );

    expect(result.events).toEqual([{ type: 'rejected', playerId: 'late', code: 'room_full' }]);
  });

  it('holds the cycles to twenty even when the caller passes the clicker defaults', () => {
    let state = cyclesLobby();
    for (let i = 0; i < 25; i += 1)
      state = apply(state, { type: 'addBot', playerId: 'host' }, 0).state;

    expect(Object.keys(state.players)).toHaveLength(20);
  });
});

describe('removeBot', () => {
  it('removes the newest bot and leaves the others', () => {
    const state = apply(withBots(3), { type: 'removeBot', playerId: 'host' }, 0, CYCLES).state;

    const names = Object.values(state.players)
      .filter((p) => p.bot)
      .map((p) => p.name);
    expect(names).toEqual(['Bot 1', 'Bot 2']);
    expect(Object.keys(cyclesOf(state).index).sort()).toEqual(['1', '2', '3']);
  });

  it('names the next bot after the ones that are left', () => {
    let state = withBots(2);
    state = apply(state, { type: 'removeBot', playerId: 'host' }, 0, CYCLES).state;
    state = apply(state, { type: 'addBot', playerId: 'host' }, 0, CYCLES).state;

    const names = Object.values(state.players)
      .filter((p) => p.bot)
      .map((p) => p.name);
    expect(names).toEqual(['Bot 1', 'Bot 2']);
  });

  it('changes nothing when there are no bots', () => {
    const lobby = cyclesLobby();

    const result = apply(lobby, { type: 'removeBot', playerId: 'host' }, 0, CYCLES);

    expect(result.state).toBe(lobby);
    expect(result.events).toEqual([]);
  });

  it('is for the host, between rounds', () => {
    const lobby = run(withBots(1), [
      { type: 'join', playerId: 'guest', connectionId: 'c-guest', name: 'Guest' },
    ]);
    expect(apply(lobby, { type: 'removeBot', playerId: 'guest' }, 0, CYCLES).events).toEqual([
      { type: 'rejected', playerId: 'guest', code: 'not_host' },
    ]);

    const started = apply(lobby, { type: 'start', playerId: 'host' }, 0, CYCLES).state;
    expect(apply(started, { type: 'removeBot', playerId: 'host' }, 0, CYCLES).events).toEqual([
      { type: 'rejected', playerId: 'host', code: 'wrong_phase' },
    ]);
  });
});

describe('a bot has no connection and still never leaves', () => {
  it('is still there when the grace period for the disconnected is long over', () => {
    const lobby = withBots(2);

    const later = apply(lobby, { type: 'tick' }, CYCLES.reconnectGraceMs * 100, CYCLES).state;

    expect(Object.values(later.players).filter((p) => p.bot)).toHaveLength(2);
    expect(Object.keys(cyclesOf(later).index)).toHaveLength(3);
  });

  it('survives the server recounting connections after a restart', () => {
    const lobby = withBots(2);

    const synced = syncConnections(lobby, { host: ['c-host'] }, 5000);

    expect(Object.values(synced.players).filter((p) => p.bot)).toHaveLength(2);
    expect(Object.values(synced.players).every((p) => p.bot || p.disconnectedAt === null)).toBe(
      true,
    );
    for (const bot of Object.values(synced.players).filter((p) => p.bot)) {
      expect(bot.disconnectedAt).toBeNull();
    }
  });
});
