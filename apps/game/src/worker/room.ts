import {
  abortRound,
  apply,
  type Command,
  createRoomState,
  DEFAULT_CONFIG,
  type GameConfig,
  type GameEvent,
  nextDeadline,
  type RoomState,
  syncConnections,
} from '@clicker/game';
import { parseClientMessage, type ServerMessage, toSnapshot } from '@clicker/protocol';
import { type Connection, Server, type WSMessage } from 'partyserver';

/** What we remember about a connection: survives the object going to sleep. */
interface Session {
  playerId: string;
  publicId: string;
}

const SNAPSHOT_INTERVAL_MS = 100;

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState = createRoomState();
  #config: GameConfig = DEFAULT_CONFIG;
  #timer: ReturnType<typeof setInterval> | null = null;
  #alarmAt: number | null | undefined = undefined;

  override async onStart(): Promise<void> {
    this.#config = {
      ...DEFAULT_CONFIG,
      countdownMs: this.#duration(this.env.COUNTDOWN_MS, DEFAULT_CONFIG.countdownMs),
      roundMs: this.#duration(this.env.ROUND_MS, DEFAULT_CONFIG.roundMs),
    };

    const stored = await this.ctx.storage.get<RoomState>('state');
    let state = stored ?? createRoomState();

    // A round phase in storage means the object restarted mid-game
    // and the clicks held in memory are lost.
    if (state.phase === 'countdown' || state.phase === 'running') {
      state = abortRound(state);
    }

    const live: Record<string, string[]> = {};
    for (const connection of this.getConnections<Session>()) {
      const session = connection.state;
      if (session !== null) {
        const ids = live[session.playerId] ?? [];
        ids.push(connection.id);
        live[session.playerId] = ids;
      }
    }

    this.#state = syncConnections(state, live, Date.now());
    await this.#persist();
    await this.#scheduleAlarm();
    this.#broadcastSnapshot();
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

  override async onClose(connection: Connection<Session>): Promise<void> {
    await this.#release(connection);
  }

  override async onError(connection: Connection<Session>): Promise<void> {
    await this.#release(connection);
  }

  async #release(connection: Connection<Session>): Promise<void> {
    const session = connection.state;
    if (session === null) return;
    await this.#run(
      { type: 'leave', playerId: session.playerId, connectionId: connection.id },
      connection,
    );
  }

  override async onAlarm(): Promise<void> {
    // The runtime clears a fired alarm on its own: there's nothing left to compare against,
    // so the next #scheduleAlarm call must write the deadline again.
    this.#alarmAt = undefined;
    await this.#run({ type: 'tick' });
  }

  /** The single path that changes state: rules, events, storage, alarm, broadcast. */
  async #run(command: Command, source?: Connection<Session>): Promise<void> {
    const applied = apply(this.#state, command, Date.now(), this.#config);
    this.#state = applied.state;

    let phaseChanged = false;
    for (const event of applied.events) {
      if (event.type === 'phaseChanged') phaseChanged = true;
      this.#handleEvent(event, source);
    }

    // A click can also close the round: advance runs before every command.
    // We skip persisting only for clicks that merely bumped the score.
    if (phaseChanged || command.type !== 'click') {
      await this.#persist();
    }
    await this.#scheduleAlarm();
    this.#syncSnapshotTimer();

    // During a round the timer sends snapshots; outside a round, every change does.
    // A phase change is sent immediately: waiting up to a hundred milliseconds isn't acceptable here.
    if (phaseChanged || this.#timer === null) {
      this.#broadcastSnapshot();
    }
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

  #syncSnapshotTimer(): void {
    const live = this.#state.phase === 'countdown' || this.#state.phase === 'running';
    if (live && this.#timer === null) {
      this.#timer = setInterval(() => this.#broadcastSnapshot(), SNAPSHOT_INTERVAL_MS);
      return;
    }
    if (!live && this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** The snapshot is built once for everyone, not per connection. */
  #broadcastSnapshot(): void {
    this.broadcast(JSON.stringify(toSnapshot(this.#state, Date.now())));
  }

  #send(connection: Connection<Session>, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  async #persist(): Promise<void> {
    await this.ctx.storage.put('state', this.#state);
  }

  #duration(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  async #scheduleAlarm(): Promise<void> {
    const deadline = nextDeadline(this.#state, this.#config);
    if (deadline === this.#alarmAt) return;
    this.#alarmAt = deadline;

    if (deadline === null) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(deadline);
  }
}
