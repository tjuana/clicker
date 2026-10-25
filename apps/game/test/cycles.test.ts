import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { CyclesState, RoomState } from '@clicker/game';
import { generateId, type SnapshotMessage } from '@clicker/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  type Client,
  connect,
  type Delta,
  type Full,
  isDelta,
  isError,
  isFull,
  isSnapshot,
  isWelcome,
  type Snapshot,
} from './support';

const isRunning = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
  isSnapshot(message) && message.phase === 'running';
const isOver = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
  isSnapshot(message) && message.phase === 'results';
const isUnderway = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
  isSnapshot(message) && message.phase !== 'lobby';

/**
 * A host in a light-cycle room with `bots` bots seated, round not started. The rounds of these
 * tests last a fraction of a second, so unless a test is about the speed it rides at the fastest
 * one: at the default there would be too few ticks in a round to see anything happen.
 */
async function lightCycleLobby(roomId: string, bots = 3, speed = 20): Promise<Client> {
  const host = await connect(roomId);
  host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
  await host.waitFor(isWelcome);
  host.send({ type: 'setMode', mode: 'cycles' });
  host.send({ type: 'setSpeed', speed });
  for (let i = 0; i < bots; i += 1) host.send({ type: 'addBot' });
  await host.waitFor(
    (message): message is Snapshot =>
      isSnapshot(message) && message.players.filter((player) => player.bot).length === bots,
  );
  return host;
}

function storedState(roomId: string): Promise<RoomState | undefined> {
  const stub = env.Room.get(env.Room.idFromName(roomId));
  return runInDurableObject(stub, (_instance, state) => state.storage.get<RoomState>('state'));
}

/** What a client that only reads `full` and `delta` knows about the round. */
function replay(full: Full, deltas: Delta[]): { field: number[]; heads: number[][] } {
  const field = new Array<number>(full.side * full.side).fill(0);
  let heads: number[][] = [];
  for (const bike of full.bikes) {
    for (const cell of bike.trail) field[cell] = bike.slot;
    if (bike.alive) {
      heads.push([
        bike.slot,
        bike.trail.at(-1) ?? -1,
        bike.dir,
        bike.rubber,
        bike.cooldown,
        bike.energy,
        bike.cap,
        bike.lit ? 1 : 0,
      ]);
    }
  }
  let tick = full.tick;
  for (const delta of deltas) {
    expect(delta.t).toBe(tick + 1);
    tick = delta.t;
    for (let i = 0; i < delta.cells.length; i += 2) {
      field[delta.cells[i] as number] = delta.cells[i + 1] as number;
    }
    heads = [];
    for (let i = 0; i < delta.heads.length; i += 8) heads.push(delta.heads.slice(i, i + 8));
  }
  return { field, heads };
}

describe('a light-cycle room over websocket', () => {
  it('lets the host pick the mode and seat bots, and shows both in the snapshot', async () => {
    const host = await lightCycleLobby(generateId(), 3);

    const snapshot = host.received.filter(isSnapshot).at(-1) as Snapshot;
    expect(snapshot.mode).toBe('cycles');

    expect(snapshot.players.filter((player) => player.bot).map((player) => player.name)).toEqual([
      'Bot 1',
      'Bot 2',
      'Bot 3',
    ]);
    expect(snapshot.players.filter((player) => !player.bot)).toHaveLength(1);
    expect(snapshot.data).toEqual({ results: null, speed: 20, walls: 'always' });
  });

  it('answers not_supported to a bot in the clicker', async () => {
    const host = await connect(generateId());
    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await host.waitFor(isWelcome);

    host.send({ type: 'addBot' });

    expect((await host.waitFor(isError)).code).toBe('not_supported');
  });

  it('refuses mode choice and bots to a guest', async () => {
    const roomId = generateId();
    await lightCycleLobby(roomId, 0);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);

    guest.send({ type: 'setMode', mode: 'clicker' });

    expect((await guest.waitFor(isError)).code).toBe('not_host');
  });

  it('streams ticks without gaps, and a client that replays them holds the same field as the room', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    host.send({ type: 'start' });
    // Asked for in the countdown or a moment into the round: both are legitimate, and the
    // client must cope with either, so the test does not pick one.
    host.send({ type: 'resync' });
    const full = await host.waitFor(isFull);

    await host.waitFor(isOver);
    const deltas = host.received.filter(isDelta).filter((delta) => delta.t > full.tick);
    // No count of deltas is asserted: a round of 200 ms holds about four ticks, and a loaded
    // machine skips late ones by design, so any minimum would make this test fail by timing.
    // What it checks is timing-free — the ticks that came form an unbroken run from the full,
    // and replaying them gives exactly the room's field.
    expect(deltas.map((delta) => delta.t)).toEqual(deltas.map((_, index) => full.tick + 1 + index));

    const seen = replay(full, deltas);
    const state = (await storedState(roomId))?.modeState as CyclesState;
    expect(state.tick).toBe(deltas.at(-1)?.t ?? full.tick);
    expect(seen.field).toEqual(Array.from(state.field));
    const heads = state.bikes
      .filter((bike) => bike.alive)
      .map((bike) => [
        bike.slot,
        bike.y * state.side + bike.x,
        bike.dir,
        bike.rubber,
        bike.cooldown,
        bike.energy,
        bike.energyCap,
        bike.lit ? 1 : 0,
      ]);
    expect(seen.heads).toEqual(heads);
  });

  it('gives a player who joins mid-round the whole round right after the welcome', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    host.send({ type: 'start' });
    await host.waitFor(isUnderway);

    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);
    const full = await guest.waitFor(isFull);

    const welcomeAt = guest.received.findIndex(isWelcome);
    expect(guest.received.findIndex(isFull)).toBe(welcomeAt + 1);
    expect(full.bikes.map((bike) => bike.id).sort()).toEqual(['1', '2', '3', '4', '5']);
    expect(full.bikes.find((bike) => bike.id === '5')?.alive).toBe(false);
  });

  it('sends everyone already in the room the whole round when it starts, without being asked', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);
    // In the lobby: there is no round yet, so nothing to send.
    expect(guest.received.filter(isFull)).toHaveLength(0);

    host.send({ type: 'start' });

    for (const client of [host, guest]) {
      const full = await client.waitFor(isFull);
      expect(full.bikes.map((bike) => bike.id).sort()).toEqual(['1', '2', '3', '4', '5']);
      // After the snapshot that announces the countdown, which tells the client what it is for.
      const countdownAt = client.received.findIndex(
        (message) => isSnapshot(message) && message.phase === 'countdown',
      );
      expect(countdownAt).toBeGreaterThan(-1);
      expect(client.received.findIndex(isFull)).toBeGreaterThan(countdownAt);
    }
  });

  it('sends everyone the whole round again when a bike joins mid-round', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);
    host.send({ type: 'start' });
    await host.waitFor(isUnderway);
    await guest.waitFor(isFull);

    const late = await connect(roomId);
    late.send({ type: 'join', playerId: generateId(), name: 'Вася' });
    await late.waitFor(isWelcome);

    for (const client of [host, guest, late]) {
      const full = await client.waitFor((message): message is Full => {
        return isFull(message) && message.bikes.some((bike) => bike.id === '6');
      });
      expect(full.bikes).toHaveLength(6);
    }
  });

  it('answers resync with the whole round', async () => {
    const host = await lightCycleLobby(generateId());
    host.send({ type: 'start' });
    await host.waitFor(isRunning);

    host.send({ type: 'resync' });

    const full = await host.waitFor(isFull);
    expect(full.bikes).toHaveLength(4);
  });

  /** A guest in a started round who has already been given the round once, unasked. */
  async function startedWithGuest(): Promise<{ host: Client; guest: Client }> {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);
    host.send({ type: 'start' });
    await guest.waitFor(isFull);
    return { host, guest };
  }

  /** The server answers a guest's `start` with an error, and answers in the order it was asked. */
  async function settled(guest: Client): Promise<void> {
    const before = guest.received.filter(isError).length;
    guest.send({ type: 'start' });
    await guest.waitFor(
      (message): message is Extract<typeof message, { type: 'error' }> =>
        isError(message) && guest.received.filter(isError).length > before,
    );
  }

  it('answers a connection that asks again at once only the first time', async () => {
    const { guest } = await startedWithGuest();
    const before = guest.received.filter(isFull).length;

    guest.send({ type: 'resync' });
    guest.send({ type: 'resync' });
    await settled(guest);

    expect(guest.received.filter(isFull).length - before).toBe(1);
  });

  it('answers the same connection again once a second has gone by', async () => {
    const { guest } = await startedWithGuest();
    const before = guest.received.filter(isFull).length;
    const realNow = Date.now();
    const clock = vi.spyOn(Date, 'now');

    try {
      clock.mockReturnValue(realNow);
      guest.send({ type: 'resync' });
      await settled(guest);
      clock.mockReturnValue(realNow + 1000);
      guest.send({ type: 'resync' });
      await settled(guest);
    } finally {
      clock.mockRestore();
    }

    expect(guest.received.filter(isFull).length - before).toBe(2);
  });

  it('builds the whole round once for connections that ask for it while nothing changes', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    const guests: Client[] = [];
    for (const name of ['Боря', 'Вася']) {
      const guest = await connect(roomId);
      guest.send({ type: 'join', playerId: generateId(), name });
      await guest.waitFor(isWelcome);
      guests.push(guest);
    }
    host.send({ type: 'start' });
    // Once the round is over the state stands still, so both asks see the same one.
    for (const guest of guests) await guest.waitFor(isOver);

    const stringified: string[] = [];
    const real = JSON.stringify;
    const spy = vi.spyOn(JSON, 'stringify').mockImplementation((...args) => {
      const text = real(...(args as Parameters<typeof JSON.stringify>));
      if ((args[0] as { type?: string } | null)?.type === 'full') stringified.push(text);
      return text;
    });

    try {
      for (const guest of guests) guest.send({ type: 'resync' });
      for (const guest of guests) await settled(guest);
    } finally {
      spy.mockRestore();
    }

    expect(stringified).toHaveLength(1);
  });

  it('refuses resync to a connection that has not joined', async () => {
    const stranger = await connect(generateId());

    stranger.send({ type: 'resync' });

    expect((await stranger.waitFor(isError)).code).toBe('not_joined');
  });

  it('ends with light-cycle results, after which nothing more is streamed', async () => {
    const host = await lightCycleLobby(generateId());
    host.send({ type: 'start' });

    const over = await host.waitFor(isOver);

    expect(over.mode).toBe('cycles');
    expect(over.data).toEqual({
      speed: 20,
      walls: 'always',
      results: expect.arrayContaining([expect.objectContaining({ id: '1', name: 'Аня' })]),
    });
    const before = host.received.filter(isDelta).length;
    expect(before).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(host.received.filter(isDelta)).toHaveLength(before);
  });

  it('sends a snapshot for the room changing, not for every tick or input', async () => {
    const host = await lightCycleLobby(generateId());
    host.send({ type: 'start' });
    await host.waitFor(isRunning);
    const snapshotsBefore = host.received.filter(isSnapshot).length;

    for (let i = 0; i < 5; i += 1)
      host.send({ type: 'input', input: { type: 'turn', side: 'left' } });
    await host.waitFor(isOver);

    // The results are the only room change left in the round; a snapshot timer would add several.
    expect(host.received.filter(isSnapshot).length - snapshotsBefore).toBe(1);
    expect(host.received.filter(isDelta).length).toBeGreaterThan(3);
  });

  it('writes nothing to storage for a tick', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId);
    host.send({ type: 'start' });
    await host.waitFor(isRunning);

    const stub = env.Room.get(env.Room.idFromName(roomId));
    const puts = await runInDurableObject(stub, async (_instance, state) => {
      let count = 0;
      const put = state.storage.put.bind(state.storage);
      state.storage.put = ((...args: Parameters<typeof put>) => {
        count += 1;
        return put(...args);
      }) as typeof state.storage.put;
      // Real ticks, not a loop of our own: five of them go by while the spy is in place.
      const startedAt = Date.now();
      const first = (host.received.filter(isDelta).at(-1)?.t ?? 0) + 5;
      while (
        Date.now() - startedAt < 2000 &&
        (host.received.filter(isDelta).at(-1)?.t ?? 0) < first
      ) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      state.storage.put = put;
      return { count, reached: host.received.filter(isDelta).at(-1)?.t ?? 0, first };
    });

    expect(puts.reached).toBeGreaterThanOrEqual(puts.first);
    // Five steps ran; the round's end is the only thing that may have been written.
    expect(puts.count).toBeLessThanOrEqual(1);
  });
});

describe('the speed of a light-cycle room', () => {
  const lobbyAt = (speed: number) => lightCycleLobby(generateId(), 1, speed);

  /** Deltas a whole round streams: the ticks that went by, which is what the speed decides. */
  async function ticksOfARound(speed: number): Promise<number> {
    const host = await lobbyAt(speed);
    host.send({ type: 'start' });
    await host.waitFor(isOver);
    return host.received.filter(isDelta).length;
  }

  it('tells the client how long a tick lasts, and what the host chose', async () => {
    const host = await lobbyAt(16);
    const lobby = host.received.filter(isSnapshot).at(-1);
    host.send({ type: 'start' });

    const full = await host.waitFor(isFull);

    expect(full.tickMs).toBe(62.5);
    expect(lobby?.data).toMatchObject({ speed: 16 });
  });

  it('is eight cells a second until the host says otherwise', async () => {
    const host = await lightCycleLobby(generateId(), 1, 8);
    host.send({ type: 'start' });

    expect((await host.waitFor(isFull)).tickMs).toBe(125);
  });

  it('is stored with the room, so it outlives the object', async () => {
    const roomId = generateId();
    await lightCycleLobby(roomId, 0, 12);

    await vi.waitFor(async () => expect((await storedState(roomId))?.settings.speed).toBe(12));
  });

  it('makes the room tick at the new pace, not the one the room was created with', async () => {
    const slow = await ticksOfARound(8);
    const fast = await ticksOfARound(20);

    // 8 against 20 cells a second: two and a half times the ticks. Far from the threshold, so
    // the scheduler's jitter does not matter.
    expect(fast).toBeGreaterThan(slow * 2);
  });

  it('answers not_host to a guest and not_supported to the clicker', async () => {
    const roomId = generateId();
    await lightCycleLobby(roomId, 0);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);

    guest.send({ type: 'setSpeed', speed: 8 });
    expect((await guest.waitFor(isError)).code).toBe('not_host');

    const clicker = await connect(generateId());
    clicker.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await clicker.waitFor(isWelcome);
    clicker.send({ type: 'setSpeed', speed: 8 });
    expect((await clicker.waitFor(isError)).code).toBe('not_supported');
  });
});

describe('the walls of a light-cycle room', () => {
  /** The snapshot where the room's walls read `walls`; the lobby is rebuilt after a mode change. */
  const seen = (client: Client, walls: 'always' | 'button') =>
    client.waitFor(
      (message): message is SnapshotMessage =>
        isSnapshot(message) && message.mode === 'cycles' && message.data.walls === walls,
    );

  it('are laid always until the host says otherwise', async () => {
    const host = await lightCycleLobby(generateId(), 0);

    await seen(host, 'always');
  });

  it('follow the host, reach every client and are stored with the room', async () => {
    const roomId = generateId();
    const host = await lightCycleLobby(roomId, 0);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);

    host.send({ type: 'setWalls', walls: 'button' });

    await seen(host, 'button');
    await seen(guest, 'button');
    await vi.waitFor(async () =>
      expect((await storedState(roomId))?.settings).toEqual({ speed: 20, walls: 'button' }),
    );
  });

  it('keep the pace of the room: only a new speed changes the tick', async () => {
    const host = await lightCycleLobby(generateId(), 1, 16);
    host.send({ type: 'setWalls', walls: 'button' });
    host.send({ type: 'start' });

    expect((await host.waitFor(isFull)).tickMs).toBe(62.5);
  });

  it('answer not_host to a guest and not_supported to the clicker', async () => {
    const roomId = generateId();
    await lightCycleLobby(roomId, 0);
    const guest = await connect(roomId);
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await guest.waitFor(isWelcome);

    guest.send({ type: 'setWalls', walls: 'button' });
    expect((await guest.waitFor(isError)).code).toBe('not_host');

    const clicker = await connect(generateId());
    clicker.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await clicker.waitFor(isWelcome);
    clicker.send({ type: 'setWalls', walls: 'button' });
    expect((await clicker.waitFor(isError)).code).toBe('not_supported');
  });
});

describe('walls on a key in a running light-cycle room', () => {
  /** The 8-number head of one slot in a delta, or undefined when that bike is not in it. */
  const headOf = (delta: Delta, slot: number) => {
    for (let i = 0; i < delta.heads.length; i += 8) {
      if (delta.heads[i] === slot) {
        const [, , , , , energy, cap, lit] = delta.heads.slice(i, i + 8);
        return { energy: energy as number, cap: cap as number, lit: lit === 1 };
      }
    }
    return undefined;
  };

  // The suite's round is 200 ms, a handful of ticks at the fastest speed: whether a press, two lit
  // ticks, a release and a refill all fit in it would be a race against the clock. This room is
  // given a long round instead, read when the room is made, so the test waits only for messages.
  it('lights the bike and spends its energy while the key is held, and refills it after', async () => {
    const mutableEnv = env as unknown as { ROUND_MS: string };
    const original = mutableEnv.ROUND_MS;
    mutableEnv.ROUND_MS = '5000';
    try {
      await holdAndRelease();
    } finally {
      mutableEnv.ROUND_MS = original;
    }
  });

  async function holdAndRelease(): Promise<void> {
    const host = await lightCycleLobby(generateId(), 1);
    const welcome = host.received.find(isWelcome);
    host.send({ type: 'setWalls', walls: 'button' });
    await host.waitFor(
      (message): message is Snapshot =>
        isSnapshot(message) && message.mode === 'cycles' && message.data.walls === 'button',
    );
    host.send({ type: 'start' });
    const full = await host.waitFor(isFull);
    const mine = full.bikes.find((bike) => bike.id === welcome?.you);
    if (mine === undefined) throw new Error('the host has no bike');
    const slot = mine.slot;
    // Nobody holds a key yet, so the bike rides bare at full energy.
    expect(mine.lit).toBe(false);
    await host.waitFor(isRunning);

    host.send({ type: 'input', input: { type: 'wall', on: true } });
    const mineIn = (delta: Delta) => headOf(delta, slot);
    const spending: number[] = [];
    // Two lit ticks in a row, each with less energy than the one before.
    await vi.waitFor(() => {
      spending.length = 0;
      for (const delta of host.received.filter(isDelta)) {
        const head = mineIn(delta);
        if (head?.lit === true) spending.push(head.energy);
      }
      expect(spending.length).toBeGreaterThanOrEqual(2);
    });
    expect(spending[0]).toBeLessThan(mine.cap);
    for (let i = 1; i < spending.length; i += 1) {
      expect(spending[i]).toBe((spending[i - 1] as number) - 1);
    }

    host.send({ type: 'input', input: { type: 'wall', on: false } });
    const floor = spending.at(-1) as number;
    await host.waitFor((message): message is Delta => {
      if (!isDelta(message)) return false;
      const head = mineIn(message);
      return head !== undefined && !head.lit && head.energy > floor;
    });
    host.close();
  }
});
