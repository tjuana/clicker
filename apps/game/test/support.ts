import { SELF } from 'cloudflare:test';
import { parseServerMessage, type ServerMessage } from '@clicker/protocol';
import { afterEach, expect } from 'vitest';

export type Snapshot = Extract<ServerMessage, { type: 'snapshot' }>;
export type Welcome = Extract<ServerMessage, { type: 'welcome' }>;
export type ServerError = Extract<ServerMessage, { type: 'error' }>;

export const isWelcome = (message: ServerMessage): message is Welcome => message.type === 'welcome';
export const isSnapshot = (message: ServerMessage): message is Snapshot =>
  message.type === 'snapshot';
export const isError = (message: ServerMessage): message is ServerError => message.type === 'error';

/** Копит входящие сообщения и позволяет дождаться нужного. */
export class Client {
  readonly received: ServerMessage[] = [];

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      const message = parseServerMessage(event.data);
      if (message !== null) this.received.push(message);
    });
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Отправка сырой строки в обход JSON.stringify — для проверки битых кадров. */
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

// Соединения, открытые текущим тестом: если тест упадёт на середине, они всё
// равно закроются в afterEach и не будут держать Durable Object живым до
// конца файла.
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
