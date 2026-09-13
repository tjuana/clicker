import { abortAllDurableObjects, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isSnapshot, isWelcome, type Snapshot } from './support';

describe('room lifecycle', () => {
  it('marks a player as disconnected when their socket closes', async () => {
    const roomId = generateId();
    const staying = await connect(roomId);
    const leaving = await connect(roomId);

    staying.send({ type: 'join', playerId: generateId(), name: 'Аня' });
    leaving.send({ type: 'join', playerId: generateId(), name: 'Боря' });
    await staying.waitFor(isWelcome);
    await leaving.waitFor(isWelcome);
    await staying.waitFor(
      (message): message is Snapshot => isSnapshot(message) && message.players.length === 2,
    );

    leaving.close();

    const snapshot = await staying.waitFor(
      (message): message is Snapshot =>
        isSnapshot(message) &&
        message.players.some((player) => player.name === 'Боря' && !player.connected),
    );

    // Игрок остаётся в списке: у него есть время вернуться.
    expect(snapshot.players).toHaveLength(2);
    staying.close();
  });

  it('releases a player when their socket errors, not just when it closes', async () => {
    const roomId = generateId();
    const client = await connect(roomId);
    const playerId = generateId();

    client.send({ type: 'join', playerId, name: 'Аня' });
    await client.waitFor(isWelcome);

    // Аварийно оборванные сокеты partyserver доставляет в onError, и onClose за
    // ними может не прийти вовсе: бьём именно по этому пути напрямую на инстансе,
    // раз настоящий обрыв транспорта нельзя воспроизвести детерминированно.
    const stub = env.Room.get(env.Room.idFromName(roomId));
    await runInDurableObject(stub, async (instance) => {
      for (const connection of instance.getConnections<{ playerId: string; publicId: string }>()) {
        await instance.onError(connection);
      }
    });

    const snapshot = await client.waitFor(
      (message): message is Snapshot =>
        isSnapshot(message) && message.players.some((player) => !player.connected),
    );

    expect(snapshot.players).toEqual([{ id: '1', name: 'Аня', clicks: 0, connected: false }]);

    client.close();
  });

  it('aborts the round when the object restarts mid-game', async () => {
    const roomId = generateId();
    const host = await connect(roomId);

    host.send({ type: 'join', playerId: generateId(), name: 'Аня', hostKey: generateId() });
    await host.waitFor(isWelcome);
    host.send({ type: 'start' });
    await host.waitFor(
      (message): message is Snapshot => isSnapshot(message) && message.phase === 'countdown',
    );

    // Перезапуск объекта: память сбрасывается, хранилище остаётся.
    // Мягкое выселение тут не подходит — во время раунда объект занят таймером рассылки.
    await abortAllDurableObjects();

    const returning = await connect(roomId);
    returning.send({ type: 'join', playerId: generateId(), name: 'Боря' });

    const snapshot = await returning.waitFor(isSnapshot);
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.notice).toBe('round_aborted');
    expect(snapshot.round).toBeNull();

    returning.close();
  });
});
