import { SELF } from 'cloudflare:test';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect, isSnapshot, isWelcome } from './support';

describe('room over websocket', () => {
  it('refuses a malformed room id before connecting', async () => {
    const response = await SELF.fetch(
      new Request('https://example.com/parties/room/not-a-room', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(404);
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
});
