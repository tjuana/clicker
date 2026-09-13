import {
  abortAllDurableObjects,
  evictDurableObject,
  runInDurableObject,
  SELF,
} from 'cloudflare:test';
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

    // The player stays in the list: they still have time to reconnect.
    expect(snapshot.players).toHaveLength(2);
    staying.close();
  });

  it('releases a player when their socket errors, not just when it closes', async () => {
    const roomId = generateId();
    const client = await connect(roomId);
    const playerId = generateId();

    client.send({ type: 'join', playerId, name: 'Аня' });
    await client.waitFor(isWelcome);

    // partyserver delivers abruptly dropped sockets to onError, and onClose
    // may never follow for them: we hit that exact path directly on the instance,
    // since a real transport drop can't be reproduced deterministically.
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

    // Restarting the object: memory resets, storage stays.
    // A soft eviction won't do here — during a round the object is busy with the broadcast timer.
    await abortAllDurableObjects();

    const returning = await connect(roomId);
    returning.send({ type: 'join', playerId: generateId(), name: 'Боря' });

    const snapshot = await returning.waitFor(isSnapshot);
    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.notice).toBe('round_aborted');
    expect(snapshot.round).toBeNull();

    returning.close();
  });

  it('broadcasts the recovered state to an already-connected client after a restart', async () => {
    const roomId = generateId();
    const client = await connect(roomId);

    client.send({ type: 'join', playerId: generateId(), name: 'Аня' });
    await client.waitFor(isWelcome);
    await client.waitFor(isSnapshot);
    const before = client.received.length;

    // A soft eviction (not abortAllDurableObjects): storage persists, and
    // the client's hibernating socket survives the object being recreated.
    const stub = env.Room.get(env.Room.idFromName(roomId));
    await evictDurableObject(stub);

    // Wake the object with a plain HTTP request, not through the client's socket: if the client
    // had sent something itself, the snapshot would come from onMessage, not from onStart.
    await SELF.fetch(new Request(`https://example.com/parties/room/${roomId}`));

    const snapshot = await client.waitFor(
      (message): message is Snapshot =>
        isSnapshot(message) && client.received.indexOf(message) >= before,
    );

    expect(snapshot.phase).toBe('lobby');
    expect(snapshot.players).toEqual([{ id: '1', name: 'Аня', clicks: 0, connected: true }]);

    client.close();
  });
});
