import {
  apply,
  type Command,
  createRoomState,
  DEFAULT_CONFIG,
  type GameConfig,
  type GameEvent,
  nextDeadline,
  type RoomState,
} from '@clicker/game';
import { parseClientMessage, type ServerMessage, toSnapshot } from '@clicker/protocol';
import { type Connection, Server, type WSMessage } from 'partyserver';

/** Что помним про соединение: переживает сон объекта. */
interface Session {
  playerId: string;
  publicId: string;
}

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState = createRoomState();
  #config: GameConfig = DEFAULT_CONFIG;

  override async onStart(): Promise<void> {
    this.#config = {
      ...DEFAULT_CONFIG,
      countdownMs: Number(this.env.COUNTDOWN_MS ?? DEFAULT_CONFIG.countdownMs),
      roundMs: Number(this.env.ROUND_MS ?? DEFAULT_CONFIG.roundMs),
    };

    this.#state = (await this.ctx.storage.get<RoomState>('state')) ?? createRoomState();
    await this.#scheduleAlarm();
  }

  override async onMessage(connection: Connection<Session>, message: WSMessage): Promise<void> {
    if (typeof message !== 'string') {
      this.#send(connection, { type: 'error', code: 'invalid_message' });
      return;
    }

    const parsed = parseClientMessage(message);
    if (parsed === null) {
      this.#send(connection, { type: 'error', code: 'invalid_message' });
      return;
    }

    if (parsed.type === 'join') {
      const previous = connection.state;
      if (previous !== null && previous.playerId !== parsed.playerId) {
        await this.#run(
          { type: 'leave', playerId: previous.playerId, connectionId: connection.id },
          connection,
        );
      }
      await this.#run(
        {
          type: 'join',
          playerId: parsed.playerId,
          connectionId: connection.id,
          name: parsed.name,
          ...(parsed.hostKey === undefined ? {} : { hostKey: parsed.hostKey }),
        },
        connection,
      );
      return;
    }

    const session = connection.state;
    if (session === null) {
      this.#send(connection, { type: 'error', code: 'not_joined' });
      return;
    }

    await this.#run({ type: parsed.type, playerId: session.playerId }, connection);
  }

  /** Единственный путь изменения состояния: правила, события, хранилище, будильник, рассылка. */
  async #run(command: Command, source?: Connection<Session>): Promise<void> {
    const applied = apply(this.#state, command, Date.now(), this.#config);
    this.#state = applied.state;

    for (const event of applied.events) {
      this.#handleEvent(event, source);
    }

    if (command.type !== 'click') {
      await this.#persist();
    }
    await this.#scheduleAlarm();
    this.#broadcastSnapshot();
  }

  #handleEvent(event: GameEvent, source?: Connection<Session>): void {
    if (event.type === 'welcome' && source !== undefined) {
      source.setState({ playerId: event.playerId, publicId: event.publicId });
      this.#send(source, { type: 'welcome', you: event.publicId, isHost: event.isHost });
      return;
    }
    if (event.type === 'rejected' && source !== undefined) {
      this.#send(source, { type: 'error', code: event.code });
    }
  }

  /** Снимок собирается один раз на всех, а не на каждое соединение. */
  #broadcastSnapshot(): void {
    this.broadcast(JSON.stringify(toSnapshot(this.#state, Date.now())));
  }

  #send(connection: Connection<Session>, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  async #persist(): Promise<void> {
    await this.ctx.storage.put('state', this.#state);
  }

  async #scheduleAlarm(): Promise<void> {
    const deadline = nextDeadline(this.#state, this.#config);
    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(deadline);
  }
}
