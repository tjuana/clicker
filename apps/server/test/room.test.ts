import { SELF } from 'cloudflare:test';
import { generateId } from '@clicker/protocol';
import { describe, expect, it } from 'vitest';
import { connect } from './support';

describe('room over websocket', () => {
  it('refuses a malformed room id before connecting', async () => {
    const response = await SELF.fetch(
      new Request('https://example.com/parties/room/not-a-room', {
        headers: { Upgrade: 'websocket' },
      }),
    );

    expect(response.status).toBe(404);
  });

  it('accepts a connection to a well-formed room id', async () => {
    const client = await connect(generateId());

    expect(client.received).toEqual([]);

    client.close();
  });
});
