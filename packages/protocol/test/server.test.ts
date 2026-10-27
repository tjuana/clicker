import {
  apply,
  type Command,
  type CyclesState,
  configFor,
  createRoomState,
  type GameEvent,
  type Player,
  type RoomState,
  syncConnections,
  type TickChanges,
  upgradeStored,
} from '@clicker/game';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '../src/client';
import {
  MAX_SERVER_MESSAGE_BYTES,
  parseServerMessage,
  toDelta,
  toFull,
  toSnapshot,
} from '../src/server';

/** Host "secret-1" and player "secret-2", round already played out. */
function playedRoom(): RoomState {
  const host = apply(
    createRoomState(),
    { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
    0,
  );
  const guest = apply(
    host.state,
    { type: 'join', playerId: 'secret-2', connectionId: 'conn-2', name: 'Боря' },
    0,
  );
  const started = apply(guest.state, { type: 'start', playerId: 'secret-1' }, 1000);
  const clicked = apply(
    started.state,
    { type: 'input', playerId: 'secret-2', input: { type: 'click' } },
    5000,
  );
  return apply(clicked.state, { type: 'tick' }, 999_999).state;
}

describe('toSnapshot', () => {
  it('shows public ids and hides the secrets', () => {
    const snapshot = toSnapshot(playedRoom(), 5000);
    const json = JSON.stringify(snapshot);

    expect(snapshot.players.map((player) => player.id)).toEqual(['1', '2']);
    expect(json).not.toContain('secret-1');
    expect(json).not.toContain('key-1');
  });

  it('sorts players by id as numbers', () => {
    let state = createRoomState();
    for (let index = 1; index <= 12; index += 1) {
      state = apply(
        state,
        {
          type: 'join',
          playerId: `secret-${index}`,
          connectionId: `conn-${index}`,
          name: `p${index}`,
        },
        0,
      ).state;
    }
    const reversed: RoomState = {
      ...state,
      players: Object.fromEntries(Object.entries(state.players).reverse()),
    };

    const snapshot = toSnapshot(reversed, 0);

    expect(snapshot.players.map((player) => player.id)).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
    ]);
  });

  it('carries the results of the finished round', () => {
    const snapshot = toSnapshot(playedRoom(), 999_999);

    expect(snapshot.phase).toBe('results');
    expect(snapshot.round).toBeNull();
    expect(snapshot.data.results).toEqual([
      { id: '2', name: 'Боря', clicks: 1, rank: 1 },
      { id: '1', name: 'Аня', clicks: 0, rank: 2 },
    ]);
  });

  it('reports the live round while it is on', () => {
    const host = apply(
      createRoomState(),
      { type: 'join', playerId: 'secret-1', connectionId: 'conn-1', name: 'Аня', hostKey: 'key-1' },
      0,
    );
    const started = apply(host.state, { type: 'start', playerId: 'secret-1' }, 1000);

    const snapshot = toSnapshot(started.state, 1000);

    expect(snapshot.phase).toBe('countdown');
    expect(snapshot.round).toEqual({ goAt: 4000, endsAt: 14000 });
    expect(snapshot.data.results).toBeNull();
    expect(snapshot.notice).toBeNull();
  });

  it('passes its own schema for a room stored before players had the bot flag', () => {
    const { bot: _bot, ...legacy } = playedRoom().players['secret-1'] as Player;
    const stored = { ...playedRoom(), players: { 'secret-1': legacy as Player } };

    const snapshot = toSnapshot(
      syncConnections(upgradeStored(stored), { 'secret-1': ['conn-9'] }, 0),
      42,
    );

    expect(snapshot.players).toEqual([{ id: '1', name: 'Аня', connected: true, bot: false }]);
    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('passes its own schema', () => {
    const snapshot = toSnapshot(playedRoom(), 42);

    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});

describe('parseServerMessage', () => {
  it('accepts welcome and error', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ v: PROTOCOL_VERSION, type: 'welcome', you: '1', isHost: true }),
      ),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'welcome',
      you: '1',
      isHost: true,
    });
    expect(
      parseServerMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', code: 'not_host' })),
    ).toEqual({
      v: PROTOCOL_VERSION,
      type: 'error',
      code: 'not_host',
    });
  });

  it('rejects an unknown error code', () => {
    expect(
      parseServerMessage(JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', code: 'nope' })),
    ).toBeNull();
  });

  it('rejects a message over the server byte limit', () => {
    const raw = `"${'x'.repeat(MAX_SERVER_MESSAGE_BYTES)}"`;

    expect(parseServerMessage(raw)).toBeNull();
  });
});

const CYCLES = configFor('cycles');

/** A light-cycle room: the host plus `bots` bots, started and stepped `steps` times. */
function cyclesRoom(
  bots: number,
  steps: number,
): { state: RoomState; lastChanges: TickChanges | null; lastTick: number } {
  const commands: Command[] = [
    {
      type: 'join',
      playerId: 'secret-host',
      connectionId: 'conn-host',
      name: 'Аня',
      hostKey: 'key-1',
    },
    { type: 'setMode', playerId: 'secret-host', mode: 'cycles' },
    ...Array.from({ length: bots }, (): Command => ({ type: 'addBot', playerId: 'secret-host' })),
    { type: 'start', playerId: 'secret-host' },
  ];
  let state = createRoomState();
  for (const command of commands) state = apply(state, command, 0, CYCLES).state;
  const goAt = state.round?.goAt ?? 0;
  state = apply(state, { type: 'tick' }, goAt, CYCLES).state;

  let lastChanges: TickChanges | null = null;
  let lastTick = 0;
  for (let i = 0; i < steps; i += 1) {
    const result = apply(state, { type: 'step' }, goAt + i, CYCLES);
    state = result.state;
    const stepped = result.events.find(
      (event): event is Extract<GameEvent, { type: 'stepped' }> => event.type === 'stepped',
    );
    if (stepped?.mode === 'cycles') {
      lastChanges = stepped.changes;
      lastTick = stepped.tick;
    }
  }
  return { state, lastChanges, lastTick };
}

describe('toSnapshot of a light-cycle room', () => {
  it('names the mode, marks the bots and passes its own schema', () => {
    const { state } = cyclesRoom(2, 3);

    const snapshot = toSnapshot(state, 7);

    expect(snapshot.mode).toBe('cycles');
    expect(snapshot.data).toMatchObject({ speed: 8, walls: 'always' });
    expect(snapshot.players.map((player) => player.bot)).toEqual([false, true, true]);
    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('carries the results of a finished round under public ids', () => {
    const { state } = cyclesRoom(2, 3);
    const over = apply(state, { type: 'tick' }, 10_000_000, CYCLES).state;
    expect(over.phase).toBe('results');

    const snapshot = toSnapshot(over, 10_000_000);

    expect(snapshot.data).toEqual({
      speed: 8,
      walls: 'always',
      results: expect.arrayContaining([expect.objectContaining({ id: '1', name: 'Аня' })]),
    });
    expect((snapshot.data.results ?? []).map((row) => row.id).sort()).toEqual(['1', '2', '3']);
    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('tells the clients the speed the host chose', () => {
    const { state } = cyclesRoom(1, 2);
    const chosen = { ...state, settings: { speed: 16, walls: 'always' } } as const;

    expect(toSnapshot(chosen, 0).data).toMatchObject({ speed: 16 });
  });

  it('tells the clients how the host wants the walls laid', () => {
    const { state } = cyclesRoom(1, 2);
    const chosen = { ...state, settings: { speed: 8, walls: 'button' } } as const;

    const snapshot = toSnapshot(chosen, 0);

    expect(snapshot.data).toMatchObject({ walls: 'button' });
    expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
  });

  it('shows no results while the round is on', () => {
    expect(toSnapshot(cyclesRoom(1, 2).state, 0).data).toEqual({
      results: null,
      speed: 8,
      walls: 'always',
    });
  });
});

describe('a snapshot is tied to its mode', () => {
  const clickerData = { scores: { '1': 0 }, results: null };
  const cyclesData = { results: null, speed: 8, walls: 'always' };

  it('refuses a light-cycle snapshot that carries the clicker data', () => {
    const snapshot = toSnapshot(cyclesRoom(1, 2).state, 0);

    expect(parseServerMessage(JSON.stringify({ ...snapshot, data: clickerData }))).toBeNull();
  });

  it('refuses a light-cycle snapshot with no walls', () => {
    const snapshot = toSnapshot(cyclesRoom(1, 2).state, 0);

    expect(
      parseServerMessage(JSON.stringify({ ...snapshot, data: { results: null, speed: 8 } })),
    ).toBeNull();
  });

  it('refuses a light-cycle snapshot with no speed', () => {
    const snapshot = toSnapshot(cyclesRoom(1, 2).state, 0);

    expect(parseServerMessage(JSON.stringify({ ...snapshot, data: { results: null } }))).toBeNull();
  });

  it('refuses a clicker snapshot that carries the light-cycle data', () => {
    const snapshot = toSnapshot(playedRoom(), 0);

    expect(parseServerMessage(JSON.stringify({ ...snapshot, data: cyclesData }))).toBeNull();
  });

  it('still accepts each mode with its own data', () => {
    for (const snapshot of [toSnapshot(cyclesRoom(1, 2).state, 0), toSnapshot(playedRoom(), 0)]) {
      expect(parseServerMessage(JSON.stringify(snapshot))).toEqual(snapshot);
    }
  });
});

describe('toFull', () => {
  it('fits the message limit for twenty bikes after four hundred steps, and passes the parser', () => {
    const { state } = cyclesRoom(19, 400);
    expect(Object.keys(state.players)).toHaveLength(20);

    const full = toFull(state);

    expect(full).not.toBeNull();
    const raw = JSON.stringify(full);
    expect(raw.length).toBeLessThan(MAX_SERVER_MESSAGE_BYTES);
    expect(parseServerMessage(raw)).toEqual(full);
    expect(full?.bikes).toHaveLength(20);
  });

  it('carries each bike energy, its capacity and whether its wall is lit', () => {
    const { state } = cyclesRoom(2, 3);
    const bike = toFull(state)?.bikes[0];
    const own = (state.modeState as CyclesState).bikes[0];
    expect(bike).toMatchObject({ energy: own?.energy, cap: own?.energyCap, lit: own?.lit });
  });

  it('says how long a tick lasts, from the speed the host chose', () => {
    const { state } = cyclesRoom(2, 3);

    expect(toFull(state)?.tickMs).toBe(125);
    expect(toFull({ ...state, settings: { speed: 16, walls: 'always' } })?.tickMs).toBe(62.5);
  });

  it('is refused by the parser without the tick length', () => {
    const { tickMs: _tickMs, ...bare } = toFull(cyclesRoom(2, 3).state) as NonNullable<
      ReturnType<typeof toFull>
    >;

    expect(parseServerMessage(JSON.stringify(bare))).toBeNull();
  });

  it('lists a trail from its oldest cell to the head', () => {
    const { state, lastChanges } = cyclesRoom(3, 30);
    const full = toFull(state);
    const delta = toDelta(0, lastChanges as TickChanges);

    const alive = (full?.bikes ?? []).filter((bike) => bike.alive);
    expect(alive.length).toBeGreaterThan(0);
    for (const bike of alive) {
      // Heads are 8-tuples; searching the flat list for the slot could land on a rubber or a cooldown.
      let at = 0;
      while (delta.heads[at] !== bike.slot) at += 8;
      // The head the tick reported is the last cell of the trail, and every cell borders the next.
      expect(bike.trail.at(-1)).toBe(delta.heads[at + 1]);
      for (let i = 1; i < bike.trail.length; i += 1) {
        const step = Math.abs((bike.trail[i] as number) - (bike.trail[i - 1] as number));
        expect([1, full?.side]).toContain(step);
      }
    }
  });

  it('sends an empty trail for a bike that is not on the field yet', () => {
    const { state } = cyclesRoom(2, 3);
    const joined = apply(
      state,
      { type: 'join', playerId: 'secret-late', connectionId: 'conn-late', name: 'Боря' },
      1000,
      CYCLES,
    ).state;

    const full = toFull(joined);

    const late = full?.bikes.find((bike) => bike.id === '4');
    expect(late).toBeDefined();
    expect(late?.alive).toBe(false);
    expect(late?.trail).toEqual([]);
    expect(full?.bikes.filter((bike) => bike.alive)).toHaveLength(3);
  });

  it('is null for the clicker and for a light-cycle room with no field yet', () => {
    expect(toFull(playedRoom())).toBeNull();

    let lobby = createRoomState();
    lobby = apply(
      lobby,
      { type: 'join', playerId: 'p', connectionId: 'c', name: 'A', hostKey: 'k' },
      0,
    ).state;
    lobby = apply(lobby, { type: 'setMode', playerId: 'p', mode: 'cycles' }, 0).state;
    expect(toFull(lobby)).toBeNull();
  });

  it('holds no secret: not the playerId, not the host key, not a bot playerId', () => {
    const { state } = cyclesRoom(3, 5);
    const json = JSON.stringify([toFull(state), toSnapshot(state, 0)]);

    expect(json).not.toContain('secret-host');
    expect(json).not.toContain('key-1');
    expect(json).not.toContain('bot-');
  });
});

describe('toDelta', () => {
  it('passes the parser and carries the tick, the cells, the heads and the events', () => {
    const { lastChanges, lastTick } = cyclesRoom(3, 10);
    const changes = lastChanges as TickChanges;

    const delta = toDelta(lastTick, changes);

    expect(delta.t).toBe(10);
    expect(delta.cells).toEqual(changes.cells);
    expect(delta.heads).toEqual(changes.heads);
    expect(delta.heads.length).toBeGreaterThan(0);
    expect(delta.heads.length % 8).toBe(0);
    expect(parseServerMessage(JSON.stringify(delta))).toEqual(delta);
  });

  it('describes every kind of event', () => {
    const delta = toDelta(1, {
      cells: [],
      heads: [],
      events: [
        { type: 'died', slot: 1, by: null },
        { type: 'died', slot: 2, by: 1 },
        { type: 'respawned', slot: 2 },
        { type: 'boost', slot: 1 },
      ],
    });

    expect(parseServerMessage(JSON.stringify(delta))).toEqual(delta);
  });
});

describe('the new error code', () => {
  it('accepts not_supported', () => {
    expect(
      parseServerMessage(
        JSON.stringify({ v: PROTOCOL_VERSION, type: 'error', code: 'not_supported' }),
      ),
    ).not.toBeNull();
  });
});

describe('an error frame read by a tab of another version', () => {
  it('reads bad_version whatever the version of the frame says', () => {
    const raw = JSON.stringify({ v: 99, type: 'error', code: 'bad_version' });

    expect(parseServerMessage(raw)).toEqual({
      v: PROTOCOL_VERSION,
      type: 'error',
      code: 'bad_version',
    });
  });

  it('still refuses every other frame of a foreign version', () => {
    for (const frame of [
      { v: 99, type: 'error', code: 'not_host' },
      { v: 99, type: 'error', code: 'bad_version', extra: 1 },
      { v: 'x', type: 'error', code: 'bad_version' },
      { v: 99, type: 'welcome', you: '1', isHost: true },
    ]) {
      expect(parseServerMessage(JSON.stringify(frame))).toBeNull();
    }
  });
});
