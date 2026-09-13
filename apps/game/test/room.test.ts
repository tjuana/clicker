import { runInDurableObject, SELF } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { RoomState } from '@clicker/game';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isError, isSnapshot, isWelcome, type Snapshot } from './support';

const isRunningSnapshot = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
  isSnapshot(message) && message.phase === 'running';

describe('room over websocket', () => {
  it('refuses a malformed room id before connecting', async () => {
    const response = await SELF.fetch(
      new Request('https://example.com/parties/room/not-a-room', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('refuses a malformed room id for a plain request too, without touching storage', async () => {
    const response = await SELF.fetch(new Request('https://example.com/parties/room/not-a-room'));
    expect(response.status).toBe(404);

    // Обе проверки идут по одному и тому же формату из isId: плохой GET не должен
    // успеть создать объект (и записать в него состояние) до отказа.
    const stub = env.Room.get(env.Room.idFromName('not-a-room'));
    const stored = await runInDurableObject(stub, (_instance, state) => state.storage.get('state'));
    expect(stored).toBeUndefined();
  });

  it('greets a player and shows them in the snapshot', async () => {
    const client = await connect(generateId());
    const playerId = generateId();

    client.send({ type: 'join', playerId, name: 'Аня' });

    const welcome = await client.waitFor(isWelcome);
    expect(welcome).toEqual({ type: 'welcome', you: '1', isHost: false });

    const snapshot = await client.waitFor(isSnapshot);
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.players).toEqual([{ id: '1', name: 'Аня', clicks: 0, connected: true }]);
    expect(JSON.stringify(snapshot)).not.toContain(playerId);

    client.close();
  });

  it('refuses to start a round for a player who is not the host', async () => {
    const client = await connect(generateId());
    client.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await client.waitFor(isWelcome);

    client.send({ type: 'start' });

    const error = await client.waitFor(isError);
    expect(error.code).toBe('not_host');

    client.close();
  });

  it('plays a whole round and agrees on the winner in both clients', async () => {
    const roomId = generateId();
    const hostKey = generateId();
    const host = await connect(roomId);
    const guest = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey });
    guest.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    const hostWelcome = await host.waitFor(isWelcome);
    expect(hostWelcome.isHost).toBe(true);
    await guest.waitFor(isWelcome);

    host.send({ type: 'start' });

    // goAt отсчитывается от момента, когда сервер обработал start, а не от
    // отправки сообщения: ждём фазу running по снимку, а не фиксированную паузу,
    // иначе на медленном раннере клики попадут ещё в countdown и молча пропадут.
    await host.waitFor(isRunningSnapshot);
    for (let i = 0; i < 5; i += 1) {
      guest.send({ type: 'click' });
    }
    host.send({ type: 'click' });

    const hasResults = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
      isSnapshot(message) && message.results !== null;
    const results = await host.waitFor(hasResults);
    const guestResults = await guest.waitFor(hasResults);

    expect(results.results?.[0]).toMatchObject({ name: 'Боря', clicks: 5, rank: 1 });
    expect(guestResults.results).toEqual(results.results);

    host.close();
    guest.close();
  });

  it('persists a finished round to durable storage, matching what clients see', async () => {
    const roomId = generateId();
    const host = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await host.waitFor(isWelcome);
    host.send({ type: 'start' });

    await host.waitFor(isRunningSnapshot);
    for (let i = 0; i < 3; i += 1) {
      host.send({ type: 'click' });
    }

    const hasResults = (message: Parameters<typeof isSnapshot>[0]): message is Snapshot =>
      isSnapshot(message) && message.results !== null;
    await host.waitFor(hasResults);

    const stub = env.Room.get(env.Room.idFromName(roomId));
    const stored = await runInDurableObject(stub, (_instance, state) =>
      state.storage.get<RoomState>('state'),
    );

    // Инвариант, который защищает фикс: хранилище не должно отставать от снимков,
    // даже когда именно клик (а не будильник) закрывает раунд — advance выполняется
    // перед каждой командой, поэтому обычный клик способен сам закрыть раунд.
    expect(stored?.phase).toBe('results');
    expect(stored?.results?.length).toBeGreaterThan(0);

    host.close();
  });

  it('falls back to default durations when the env vars are malformed', async () => {
    const roomId = generateId();
    const mutableEnv = env as unknown as { COUNTDOWN_MS: string; ROUND_MS: string };
    const original = { countdown: mutableEnv.COUNTDOWN_MS, round: mutableEnv.ROUND_MS };
    mutableEnv.COUNTDOWN_MS = 'not-a-number';
    mutableEnv.ROUND_MS = 'also-not-a-number';

    try {
      const host = await connect(roomId);
      host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
      await host.waitFor(isWelcome);
      host.send({ type: 'start' });

      const snapshot = await host.waitFor(
        (message): message is Snapshot => isSnapshot(message) && message.round !== null,
      );

      // Без фолбэка goAt/endsAt были бы NaN, setAlarm(NaN) бросал бы исключение на
      // каждой команде, и этот снимок никогда бы не пришёл.
      expect(Number.isFinite(snapshot.round?.goAt)).toBe(true);
      expect(Number.isFinite(snapshot.round?.endsAt)).toBe(true);

      host.close();
    } finally {
      mutableEnv.COUNTDOWN_MS = original.countdown;
      mutableEnv.ROUND_MS = original.round;
    }
  });

  it('does not rewrite the alarm while the round deadline stays the same', async () => {
    const roomId = generateId();
    const host = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await host.waitFor(isWelcome);
    host.send({ type: 'start' });
    await host.waitFor(isRunningSnapshot);

    // Пять кликов подряд во время раунда: дедлайн (endsAt + lateGraceMs) не
    // меняется, так что будильник не должен переписываться ни разу.
    const stub = env.Room.get(env.Room.idFromName(roomId));
    const setAlarmCalls = await runInDurableObject(stub, async (instance, state) => {
      const original = state.storage.setAlarm.bind(state.storage);
      let calls = 0;
      state.storage.setAlarm = (...args: Parameters<typeof state.storage.setAlarm>) => {
        calls += 1;
        return original(...args);
      };

      const [connection] = [...instance.getConnections<{ playerId: string; publicId: string }>()];
      if (connection === undefined) throw new Error('no connection found on the instance');

      for (let i = 0; i < 5; i += 1) {
        await instance.onMessage(connection, JSON.stringify({ type: 'click' }));
      }

      return calls;
    });

    expect(setAlarmCalls).toBe(0);

    host.close();
  });

  it('rejects a malformed frame with invalid_message', async () => {
    const client = await connect(generateId());
    client.sendRaw('{');

    const error = await client.waitFor(isError);
    expect(error.code).toBe('invalid_message');

    client.close();
  });

  it('rejects a click sent before joining with not_joined', async () => {
    const client = await connect(generateId());
    client.send({ type: 'click' });

    const error = await client.waitFor(isError);
    expect(error.code).toBe('not_joined');

    client.close();
  });

  it('streams more than one snapshot during a running round', async () => {
    const roomId = generateId();
    const host = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await host.waitFor(isWelcome);
    host.send({ type: 'start' });
    await host.waitFor(isRunningSnapshot);

    // 10 Гц рассылка — сердце сервера: ждём, пока накопится хотя бы три снимка
    // фазы running, вместо того чтобы гадать с фиксированной паузой.
    const deadline = Date.now() + 2000;
    let runningSnapshots: Snapshot[] = [];
    do {
      runningSnapshots = host.received.filter(isRunningSnapshot);
      if (runningSnapshots.length >= 3) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    } while (Date.now() < deadline);

    expect(runningSnapshots.length).toBeGreaterThanOrEqual(3);

    host.close();
  });
});
