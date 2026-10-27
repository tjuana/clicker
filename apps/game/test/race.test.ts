import { env } from 'cloudflare:workers';
import { generateId } from '@clicker/protocol';
import { describe, expect, it, vi } from 'vitest';
import {
  type Client,
  connect,
  isRaceDelta,
  isRaceFull,
  isSnapshot,
  isWelcome,
  type Snapshot,
} from './support';

const isRunning = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
  isSnapshot(message) && message.phase === 'running';
const isOver = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
  isSnapshot(message) && message.phase === 'results';

/**
 * The suite's round is 200 ms, six ticks at 30 Hz. A test that needs a race to be going on
 * while it looks at it gets a long round instead, read when the room is made, so that it waits
 * for messages and never for the clock. The round is not run out: closing the sockets ends it.
 */
async function withLongRound(body: () => Promise<void>): Promise<void> {
  const mutableEnv = env as unknown as { ROUND_MS: string };
  const original = mutableEnv.ROUND_MS;
  mutableEnv.ROUND_MS = '5000';
  try {
    await body();
  } finally {
    mutableEnv.ROUND_MS = original;
  }
}

/** A countdown too long to end while a test looks at it, read when the room is made. */
async function withLongCountdown(body: () => Promise<void>): Promise<void> {
  const mutableEnv = env as unknown as { COUNTDOWN_MS: string };
  const original = mutableEnv.COUNTDOWN_MS;
  mutableEnv.COUNTDOWN_MS = '60000';
  try {
    await body();
  } finally {
    mutableEnv.COUNTDOWN_MS = original;
  }
}

/** A host in a race room with `bots` bots seated, round not started. */
async function raceLobby(roomId: string, bots = 3): Promise<Client> {
  const host = await connect(roomId);
  host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
  await host.waitFor(isWelcome);
  host.send({ type: 'setMode', mode: 'race' });
  for (let i = 0; i < bots; i += 1) host.send({ type: 'addBot' });
  await host.waitFor(
    (message): message is Snapshot =>
      isSnapshot(message) &&
      message.mode === 'race' &&
      message.players.filter((player) => player.bot).length === bots,
  );
  return host;
}

describe('a race room', () => {
  it('streams ticks without gaps from the full, one tuple per car', async () => {
    await withLongRound(async () => {
      const host = await raceLobby(generateId());
      host.send({ type: 'start' });
      const full = await host.waitFor(isRaceFull);
      expect(full.cars).toHaveLength(4);

      await vi.waitFor(() => {
        expect(host.received.filter(isRaceDelta).length).toBeGreaterThanOrEqual(6);
      });
      const deltas = host.received.filter(isRaceDelta).filter((delta) => delta.t > full.tick);
      // No count is asserted beyond the wait: only that what came is an unbroken run.
      expect(deltas.map((delta) => delta.t)).toEqual(
        deltas.map((_, index) => full.tick + 1 + index),
      );
      for (const delta of deltas) expect(delta.cars).toHaveLength(4 * 7);
    });
  });

  it('puts the keys a player holds on their car', async () => {
    await withLongRound(async () => {
      const host = await raceLobby(generateId(), 1);
      const welcome = host.received.find(isWelcome);
      host.send({ type: 'start' });
      const full = await host.waitFor(isRaceFull);
      const mine = full.cars.find((car) => car.id === welcome?.you);
      if (mine === undefined) throw new Error('the host has no car');
      expect(mine.speed).toBe(0);
      await host.waitFor(isRunning);

      host.send({ type: 'input', input: { type: 'keys', mask: 1 } });

      // Gas only: the car's speed climbs tick after tick. Its place in a tuple is slot, x, y,
      // heading, speed, so the speed is four after the slot.
      const speeds = (): number[] =>
        host.received.filter(isRaceDelta).flatMap((delta) => {
          const at = delta.cars.findIndex((value, i) => i % 7 === 0 && value === mine.slot);
          return at < 0 ? [] : [delta.cars[at + 4] as number];
        });
      await vi.waitFor(() => {
        expect(speeds().filter((speed) => speed > 0).length).toBeGreaterThanOrEqual(3);
      });
      const rising = speeds().filter((speed) => speed > 0);
      expect(rising).toEqual([...rising].sort((a, b) => a - b));
    });
  });

  it('ends at the clock with the standings of every car', async () => {
    // Everyone finishing before the clock is the rules' business (mode-over.test.ts): three laps
    // of the Ring take a bot over a minute, which no test here may wait for.
    const host = await raceLobby(generateId());
    host.send({ type: 'start' });

    const over = await host.waitFor(isOver);

    if (over.mode !== 'race') throw new Error('not a race snapshot');
    const rows = over.data.results ?? [];
    expect(rows.map((row) => row.rank).sort()).toEqual([1, 2, 3, 4]);
    expect(rows.every((row) => row.name !== '')).toBe(true);
  });

  it('gives a player who joins mid-race the whole race right after the welcome', async () => {
    await withLongRound(async () => {
      const roomId = generateId();
      const host = await raceLobby(roomId);
      host.send({ type: 'start' });
      // A tick has been played: before the first one the cars are still on the grid and a
      // newcomer would be given a place on it.
      await host.waitFor(isRaceDelta);
      const seen = host.received.filter(isRaceFull).length;

      const guest = await connect(roomId);
      guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
      const welcome = await guest.waitFor(isWelcome);
      const full = await guest.waitFor(isRaceFull);

      expect(guest.received.findIndex(isRaceFull)).toBe(guest.received.findIndex(isWelcome) + 1);
      // The newcomer is off the field until the next race; nobody else's slot has moved, so nobody
      // else is sent the race again.
      expect(full.cars.map((car) => car.id)).not.toContain(welcome.you);
      expect(full.cars).toHaveLength(4);
      expect(host.received.filter(isRaceFull)).toHaveLength(seen);
    });
  });

  it('seats a player who joins in the countdown on the grid, and tells everybody', async () => {
    await withLongCountdown(async () => {
      const roomId = generateId();
      const host = await raceLobby(roomId);
      host.send({ type: 'start' });
      const first = await host.waitFor(isRaceFull);
      expect(first.cars).toHaveLength(4);

      const guest = await connect(roomId);
      guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
      const welcome = await guest.waitFor(isWelcome);
      const full = await guest.waitFor(isRaceFull);

      expect(guest.received.findIndex(isRaceFull)).toBe(guest.received.findIndex(isWelcome) + 1);
      expect(full.cars.map((car) => car.id)).toContain(welcome.you);
      expect(full.cars).toHaveLength(5);
      // The grid has a new car in it, so the table of slots the others hold is out of date.
      await vi.waitFor(() => {
        expect(host.received.filter(isRaceFull)).toHaveLength(2);
      });
      expect(host.received.filter(isRaceFull)[1]?.cars).toHaveLength(5);
    });
  });

  it('answers a resync with the whole race', async () => {
    await withLongRound(async () => {
      const host = await raceLobby(generateId(), 1);
      host.send({ type: 'start' });
      await host.waitFor(isRunning);
      const seen = host.received.filter(isRaceFull).length;

      host.send({ type: 'resync' });

      await vi.waitFor(() => {
        expect(host.received.filter(isRaceFull).length).toBe(seen + 1);
      });
    });
  });
});
