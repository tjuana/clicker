import {
  abortRound,
  apply,
  type Command,
  type CyclesState,
  configFor,
  createRoomState,
  type GameConfig,
  type GameEvent,
  nextDeadline,
  type RoomState,
  syncConnections,
} from '@clicker/game';
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ServerMessage,
  toDelta,
  toFull,
  toSnapshot,
} from '@clicker/protocol';
import { type Connection, Server, type WSMessage } from 'partyserver';
import { Ticker } from './ticker';

/** What we remember about a connection: survives the object going to sleep. */
interface Session {
  playerId: string;
  publicId: string;
}

const SNAPSHOT_INTERVAL_MS = 100;

/** How many bikes the room has seated: a new one means every client's slot table is out of date. */
function seats(state: RoomState): number {
  return state.mode === 'cycles' ? (state.modeState as CyclesState).bikes.length : 0;
}

export class Room extends Server<Env> {
  static options = { hibernate: true };

  #state: RoomState = createRoomState();
  /** What the environment changes, if anything. Wins over the mode: a test round must be short in every mode. */
  #overrides: Partial<GameConfig> = {};
  #config: GameConfig = configFor(this.#state.mode);
  #timer: ReturnType<typeof setInterval> | null = null;
  #ticker = new Ticker<ReturnType<typeof setInterval>>({
    now: () => Date.now(),
    setInterval: (wake, ms) => setInterval(wake, ms),
    clearInterval: (handle) => clearInterval(handle),
    step: (now) => this.#stepOnce(now),
  });
  #alarmAt: number | null | undefined = undefined;

  override async onStart(): Promise<void> {
    // Only what is set and sane: the rest comes from the mode, which knows how long its round is.
    const countdownMs = this.#duration(this.env.COUNTDOWN_MS);
    const roundMs = this.#duration(this.env.ROUND_MS);
    this.#overrides = {
      ...(countdownMs === undefined ? {} : { countdownMs }),
      ...(roundMs === undefined ? {} : { roundMs }),
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
    this.#config = this.#configOf(this.#state);
    await this.#persist();
    await this.#scheduleAlarm();
    this.#broadcastSnapshot();
  }

  override async onMessage(connection: Connection<Session>, message: WSMessage): Promise<void> {
    if (typeof message !== 'string') {
      this.#send(connection, { v: PROTOCOL_VERSION, type: 'error', code: 'invalid_message' });
      return;
    }

    const parsed = parseClientMessage(message);
    if (!parsed.ok) {
      this.#send(connection, { v: PROTOCOL_VERSION, type: 'error', code: parsed.reason });
      return;
    }
    const incoming = parsed.message;

    if (incoming.type === 'join') {
      const previous = connection.state;
      if (previous !== null && previous.playerId !== incoming.playerId) {
        await this.#run(
          { type: 'leave', playerId: previous.playerId, connectionId: connection.id },
          connection,
        );
      }
      await this.#run(
        {
          type: 'join',
          playerId: incoming.playerId,
          connectionId: connection.id,
          name: incoming.name,
          ...(incoming.hostKey === undefined ? {} : { hostKey: incoming.hostKey }),
        },
        connection,
      );
      return;
    }

    const session = connection.state;
    if (session === null) {
      this.#send(connection, { v: PROTOCOL_VERSION, type: 'error', code: 'not_joined' });
      return;
    }

    switch (incoming.type) {
      case 'input':
        await this.#run(
          { type: 'input', playerId: session.playerId, input: incoming.input },
          connection,
        );
        return;
      case 'resync': {
        const full = this.#fullJson();
        if (full !== null) connection.send(full);
        return;
      }
      case 'setMode':
        await this.#run(
          { type: 'setMode', playerId: session.playerId, mode: incoming.mode },
          connection,
        );
        return;
      case 'addBot':
      case 'removeBot':
      case 'start':
        await this.#run({ type: incoming.type, playerId: session.playerId }, connection);
        return;
    }
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
    const phaseChanged = this.#apply(command, source);
    await this.#settle(command, phaseChanged);
  }

  /**
   * The synchronous half: rules, events, timers. Everything that must be ordered with the next
   * message or the next step happens here, before the first await.
   */
  #apply(command: Command, source?: Connection<Session>, now = Date.now()): boolean {
    const applied = apply(this.#state, command, now, this.#config);
    const modeChanged = applied.state.mode !== this.#state.mode;
    const newSeat = seats(applied.state) > seats(this.#state);
    this.#state = applied.state;
    if (modeChanged) this.#config = this.#configOf(applied.state);

    let phaseChanged = false;
    for (const event of applied.events) {
      if (event.type === 'phaseChanged') phaseChanged = true;
      this.#handleEvent(event, source, newSeat);
    }
    this.#syncSnapshotTimer();
    this.#syncTicker();
    return phaseChanged;
  }

  /** The asynchronous half: storage, the alarm and the snapshot. */
  async #settle(command: Command, phaseChanged: boolean): Promise<void> {
    // An input or a step is the hot path: up to thirty a second per player, twenty a second per
    // room. Neither changes what must survive a restart, so neither writes — unless it also
    // closed the round (advance runs before every command), which is a phase change.
    const hot = command.type === 'input' || command.type === 'step';
    if (phaseChanged || !hot) await this.#persist();
    await this.#scheduleAlarm();

    // During a clicker round the timer sends snapshots; a living mode sends none on a timer,
    // because its deltas carry the round. Otherwise every room change is sent at once.
    // A phase change always is: waiting up to a hundred milliseconds isn't acceptable here.
    if (phaseChanged || (!hot && this.#timer === null)) this.#broadcastSnapshot();

    // Slots are renumbered for every round, so nobody already in the room can know this one's.
    // After the snapshot, which tells the client what the round is for.
    if (phaseChanged && this.#state.phase === 'countdown') {
      const full = this.#fullJson();
      if (full !== null) this.broadcast(full);
    }
  }

  #handleEvent(event: GameEvent, source?: Connection<Session>, newSeat = false): void {
    if (event.type === 'welcome' && source !== undefined) {
      source.setState({ playerId: event.playerId, publicId: event.publicId });
      this.#send(source, {
        v: PROTOCOL_VERSION,
        type: 'welcome',
        you: event.publicId,
        isHost: event.isHost,
      });
      // Someone arriving in the middle of a light-cycle round has missed every delta so far.
      // Right after the welcome, so the next thing they hear is the state the deltas build on.
      // A bike that did not exist a moment ago has a slot nobody else knows: everyone gets the
      // round again, the newcomer included, in the same synchronous step as the welcome.
      const live = this.#state.phase === 'countdown' || this.#state.phase === 'running';
      const full = live ? this.#fullJson() : null;
      if (full !== null) {
        if (newSeat) this.broadcast(full);
        else source.send(full);
      }
      return;
    }
    if (event.type === 'rejected' && source !== undefined) {
      this.#send(source, { v: PROTOCOL_VERSION, type: 'error', code: event.code });
      return;
    }
    // One string for the whole room, however many are connected.
    if (event.type === 'stepped')
      this.broadcast(JSON.stringify(toDelta(event.tick, event.changes)));
  }

  /** The base config belongs to the mode in play; what the environment sets wins over it. */
  #configOf(state: RoomState): GameConfig {
    return { ...configFor(state.mode), ...this.#overrides };
  }

  /** Only for a mode without its own tick: the clicker has to show live scores. */
  #syncSnapshotTimer(): void {
    const round = this.#state.phase === 'countdown' || this.#state.phase === 'running';
    const live = round && this.#config.tickMs === null;
    if (live && this.#timer === null) {
      this.#timer = setInterval(() => this.#broadcastSnapshot(), SNAPSHOT_INTERVAL_MS);
      return;
    }
    if (!live && this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  /** Runs while a living mode's round runs, and only then: an idle room must be free to sleep. */
  #syncTicker(): void {
    this.#ticker.sync(this.#state.phase === 'running', this.#config.tickMs);
  }

  /** One owed step. Returns whether the round goes on, so the ticker stops at its end. */
  #stepOnce(now: number): boolean {
    const phaseChanged = this.#apply({ type: 'step' }, undefined, now);
    // Only the end of the round has anything to write; a plain step settles nothing.
    if (phaseChanged) void this.#settle({ type: 'step' }, true);
    return this.#state.phase === 'running';
  }

  /** The snapshot is built once for everyone, not per connection. */
  #broadcastSnapshot(): void {
    this.broadcast(JSON.stringify(toSnapshot(this.#state, Date.now())));
  }

  /** `null` outside a light-cycle round. One string, however many connections it goes to. */
  #fullJson(): string | null {
    const full = toFull(this.#state);
    return full === null ? null : JSON.stringify(full);
  }

  #send(connection: Connection<Session>, message: ServerMessage): void {
    connection.send(JSON.stringify(message));
  }

  async #persist(): Promise<void> {
    await this.ctx.storage.put('state', this.#state);
  }

  #duration(value: string | undefined): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
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
