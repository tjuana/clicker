import { SELF } from 'cloudflare:test';
import { PROTOCOL_VERSION, parseServerMessage, type ServerMessage } from '@clicker/protocol';
import { afterEach, expect } from 'vitest';

export type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
export type Welcome = Extract<ServerMessage, { type: 'welcome' }>;
export type ServerError = Extract<ServerMessage, { type: 'error' }>;

export const isWelcome = (message: ServerMessage): message is Welcome => message.type === 'welcome';
export const isSnapshot = (message: ServerMessage): message is Snapshot =>
  message.type === 'snapshot';
export const isError = (message: ServerMessage): message is ServerError => message.type === 'error';

/** Accumulates incoming messages and lets you wait for the one you need. */
export class Client {
  readonly received: ServerMessage[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (message !== null) this.received.push(message);
    });
  }

  /** Stamps the protocol version, so no test has to repeat it. */
  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify({ v: PROTOCOL_VERSION, ...message }));
  }

  /** Sends a raw string, bypassing JSON.stringify — for testing malformed frames. */
  sendRaw(raw: string): void {
    this.socket.send(raw);
  }

  close(): void {
    this.socket.close();
  }

  async waitFor<T extends ServerMessage>(
    predicate: (message: ServerMessage) => message is T,
    timeoutMs = 2000,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.received.find(predicate);
      if (found !== undefined) return found;
      if (Date.now() > deadline) {
        throw new Error(`timed out; received: ${JSON.stringify(this.received)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
}

// Connections opened by the current test: if the test fails partway through, they'll
// still be closed in afterEach and won't keep the Durable Object alive until
// the end of the file.
const openClients = new Set<Client>();

afterEach(() => {
  for (const client of openClients) client.close();
  openClients.clear();
});

export async function connect(roomId: string): Promise<Client> {
  const response = await SELF.fetch(
    new Request(`https://example.com/parties/room/${roomId}`, {
      headers: { Upgrade: 'websocket' },
    }),
  );
  expect(response.status).toBe(101);
  const socket = response.webSocket;
  if (!socket) throw new Error('no websocket in the response');
  socket.accept();
  const client = new Client(socket);
  openClients.add(client);
  return client;
}
