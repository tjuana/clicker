import { type ModeState, modeFor } from '../modes';
import { comparePublicIds } from '../modes/clicker';
import { advance } from './advance';
import type { Command, ErrorCode, GameEvent, InputCommand, JoinCommand } from './commands';
import { configFor, DEFAULT_CONFIG, type GameConfig } from './config';
import type { Player, RoomState } from './state';

export interface ApplyResult {
  state: RoomState;
  events: GameEvent[];
}

/**
 * The only place the room state changes.
 * The input state is never mutated and time always arrives as a parameter.
 */
export function apply(
  state: RoomState,
  command: Command,
  now: number,
  config: GameConfig = DEFAULT_CONFIG,
): ApplyResult {
  const advanced = advance(state, now, config);
  const phaseEvents: GameEvent[] = advanced.phases.map((phase) => ({
    type: 'phaseChanged',
    phase,
  }));
  const handled = handle(advanced.state, command, now, config);
  return { state: handled.state, events: [...phaseEvents, ...handled.events] };
}

function handle(state: RoomState, command: Command, now: number, config: GameConfig): ApplyResult {
  switch (command.type) {
    case 'tick':
      return { state, events: [] };
    case 'step':
      return step(state);
    case 'setMode':
      return setMode(state, command, now, config);
    case 'setSpeed':
      return setSpeed(state, command);
    case 'setWalls':
      return setWalls(state, command);
    case 'addBot':
      return addBot(state, command.playerId, now, config);
    case 'removeBot':
      return removeBot(state, command.playerId);
    case 'join':
      return join(state, command, now, config);
    case 'leave':
      return leave(state, command.playerId, command.connectionId, now);
    case 'start':
      return start(state, command.playerId, now, config);
    case 'input':
      return input(state, command, now, config);
  }
}

function reject(state: RoomState, playerId: string, code: ErrorCode): ApplyResult {
  return { state, events: [{ type: 'rejected', playerId, code }] };
}

function withPlayer(state: RoomState, playerId: string, player: Player): RoomState {
  return { ...state, players: { ...state.players, [playerId]: player } };
}

/** The cap belongs to the mode in play, whatever base config the caller hands in. */
function isFull(state: RoomState, config: GameConfig): boolean {
  return Object.keys(state.players).length >= configFor(state.mode, config).maxPlayers;
}

/** Host-only and between rounds: the guard shared by every command that reshapes the lobby. */
function lobbyHostOnly(state: RoomState, playerId: string): ApplyResult | null {
  if (state.players[playerId] === undefined) return reject(state, playerId, 'not_joined');
  if (!state.hosts.includes(playerId)) return reject(state, playerId, 'not_host');
  if (state.phase !== 'lobby' && state.phase !== 'results')
    return reject(state, playerId, 'wrong_phase');
  return null;
}

function setMode(
  state: RoomState,
  command: Extract<Command, { type: 'setMode' }>,
  now: number,
  config: GameConfig,
): ApplyResult {
  const refused = lobbyHostOnly(state, command.playerId);
  if (refused !== null) return refused;
  if (command.mode === state.mode) return { state, events: [] };

  const next = modeFor(command.mode);
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    // A bot is nothing without a mode that plays it.
    if (next.bots || !player.bot) players[playerId] = player;
  }
  // Counted after the bots went home: the cap is about who would be seated.
  if (Object.keys(players).length > configFor(command.mode, config).maxPlayers) {
    return reject(state, command.playerId, 'room_full');
  }

  // Seated in publicId order, so a slot means the same thing however the room lists its players.
  let modeState = next.create(now | 0);
  const seated = Object.values(players).sort((a, b) => comparePublicIds(a.publicId, b.publicId));
  for (const player of seated) {
    modeState = next.addPlayer(modeState, player.publicId, player.bot, now, config, state.settings);
  }

  // The results of the old mode mean nothing in the new one, so the room goes back to the lobby.
  const fromResults = state.phase === 'results';
  return {
    state: {
      ...state,
      mode: command.mode,
      phase: fromResults ? 'lobby' : state.phase,
      players,
      modeState,
    },
    events: fromResults ? [{ type: 'phaseChanged', phase: 'lobby' }] : [],
  };
}

/** Only the light cycles have a pace; the same guard as every lobby setting, then the mode. */
function setSpeed(state: RoomState, command: Extract<Command, { type: 'setSpeed' }>): ApplyResult {
  const refused = lobbyHostOnly(state, command.playerId);
  if (refused !== null) return refused;
  if (state.mode !== 'cycles') return reject(state, command.playerId, 'not_supported');
  if (command.speed === state.settings.speed) return { state, events: [] };
  return { state: { ...state, settings: { ...state.settings, speed: command.speed } }, events: [] };
}

function setWalls(state: RoomState, command: Extract<Command, { type: 'setWalls' }>): ApplyResult {
  const refused = lobbyHostOnly(state, command.playerId);
  if (refused !== null) return refused;
  if (state.mode !== 'cycles') return reject(state, command.playerId, 'not_supported');
  if (command.walls === state.settings.walls) return { state, events: [] };
  return { state: { ...state, settings: { ...state.settings, walls: command.walls } }, events: [] };
}

function addBot(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  const refused = lobbyHostOnly(state, playerId);
  if (refused !== null) return refused;
  const mode = modeFor(state.mode);
  if (!mode.bots) return reject(state, playerId, 'not_supported');
  if (isFull(state, config)) return reject(state, playerId, 'room_full');

  const publicId = String(state.nextSeq);
  const bots = Object.values(state.players).filter((player) => player.bot).length;
  return {
    state: {
      ...withPlayer(state, `bot-${publicId}`, {
        publicId,
        name: `Bot ${bots + 1}`,
        connectionIds: [],
        disconnectedAt: null,
        bot: true,
      }),
      nextSeq: state.nextSeq + 1,
      modeState: mode.addPlayer(state.modeState, publicId, true, now, config, state.settings),
    },
    events: [],
  };
}

/** The newest bot goes first, so the names stay Bot 1…n without gaps. */
function removeBot(state: RoomState, playerId: string): ApplyResult {
  const refused = lobbyHostOnly(state, playerId);
  if (refused !== null) return refused;

  let newest: [string, Player] | null = null;
  for (const entry of Object.entries(state.players)) {
    if (!entry[1].bot) continue;
    if (newest === null || comparePublicIds(entry[1].publicId, newest[1].publicId) > 0) {
      newest = entry;
    }
  }
  if (newest === null) return { state, events: [] };

  const players = { ...state.players };
  delete players[newest[0]];
  return {
    state: {
      ...state,
      players,
      modeState: modeFor(state.mode).removePlayers(state.modeState, [newest[1].publicId]),
    },
    events: [],
  };
}

function join(
  state: RoomState,
  command: JoinCommand,
  now: number,
  config: GameConfig,
): ApplyResult {
  const existing = state.players[command.playerId];
  let nextSeq = state.nextSeq;
  let modeState = state.modeState;
  let player: Player;

  if (existing !== undefined) {
    player = {
      ...existing,
      name: command.name,
      connectionIds: existing.connectionIds.includes(command.connectionId)
        ? existing.connectionIds
        : [...existing.connectionIds, command.connectionId],
      disconnectedAt: null,
    };
    // Whatever the mode keeps for them — a bike that left the field — is theirs to take back.
    modeState = modeFor(state.mode).rejoin(state.modeState, existing.publicId, state.settings);
  } else {
    if (isFull(state, config)) {
      return reject(state, command.playerId, 'room_full');
    }
    const publicId = String(state.nextSeq);
    player = {
      publicId,
      name: command.name,
      connectionIds: [command.connectionId],
      disconnectedAt: null,
      bot: false,
    };
    nextSeq = state.nextSeq + 1;
    modeState = modeFor(state.mode).addPlayer(
      state.modeState,
      publicId,
      false,
      now,
      config,
      state.settings,
    );
  }

  let hostKey = state.hostKey;
  let hosts = state.hosts;
  if (command.hostKey !== undefined) {
    if (hostKey === null) hostKey = command.hostKey;
    if (hostKey === command.hostKey && !hosts.includes(command.playerId)) {
      hosts = [...hosts, command.playerId];
    }
  }

  return {
    state: { ...withPlayer(state, command.playerId, player), nextSeq, hostKey, hosts, modeState },
    events: [
      {
        type: 'welcome',
        playerId: command.playerId,
        publicId: player.publicId,
        isHost: hosts.includes(command.playerId),
      },
    ],
  };
}

function leave(state: RoomState, playerId: string, connectionId: string, now: number): ApplyResult {
  const player = state.players[playerId];
  if (player === undefined) return { state, events: [] };

  const connectionIds = player.connectionIds.filter((id) => id !== connectionId);
  // The id was not there: a repeated leave must not move the eviction deadline.
  if (connectionIds.length === player.connectionIds.length) return { state, events: [] };

  const left = withPlayer(state, playerId, {
    ...player,
    connectionIds,
    disconnectedAt:
      connectionIds.length === 0 && player.disconnectedAt === null ? now : player.disconnectedAt,
  });
  // The mode decides what a vanished player leaves behind: the clicker keeps the score, the
  // cycles take the bike off the field. The countdown counts: the bikes are placed when it starts.
  // Outside a round there is nothing on the field to take.
  const inRound = state.phase === 'countdown' || state.phase === 'running';
  if (connectionIds.length > 0 || !inRound) return { state: left, events: [] };
  const mode = modeFor(state.mode);
  return {
    state: { ...left, modeState: mode.abandon(state.modeState, player.publicId) },
    events: [],
  };
}

/**
 * A living mode counts its ticks in `tick`. The interface does not name the field because the
 * clicker has none, so the one place that needs it reads it here.
 */
function tickOf(state: ModeState): number {
  return 'tick' in state ? state.tick : 0;
}

/**
 * Not an error outside a running round or in a mode with nothing to step: a timer can wake on
 * the edge of a phase, and the clock is the only thing that knows which side it landed on.
 */
function step(state: RoomState): ApplyResult {
  const stepMode = modeFor(state.mode).step;
  if (state.phase !== 'running' || stepMode === null) return { state, events: [] };

  const stepped = stepMode(state.modeState, state.settings);
  return {
    state: { ...state, modeState: stepped.state },
    // The tick number comes from the state that was produced, so it cannot drift from it.
    // `state.mode` and the changes travel together, as `modeFor` says; a mode that steps is
    // never the clicker, so the pairing is asserted here once.
    events: [
      {
        type: 'stepped',
        tick: tickOf(stepped.state),
        mode: state.mode,
        changes: stepped.changes,
      } as GameEvent,
    ],
  };
}

function start(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  if (state.players[playerId] === undefined) return reject(state, playerId, 'not_joined');
  if (!state.hosts.includes(playerId)) return reject(state, playerId, 'not_host');
  if (state.phase !== 'lobby' && state.phase !== 'results')
    return reject(state, playerId, 'wrong_phase');

  const goAt = now + config.countdownMs;
  const endsAt = goAt + config.roundMs;

  // Someone still listed but with no connection — they closed the tab in the lobby, or the object
  // restarted and `clear` forgave every bike — would otherwise be seated and ride into walls with
  // nobody at the wheel. The mode decides what that means: the cycles leave them off the field.
  const mode = modeFor(state.mode);
  let modeState = state.modeState;
  for (const player of Object.values(state.players)) {
    if (!player.bot && player.connectionIds.length === 0) {
      modeState = mode.abandon(modeState, player.publicId);
    }
  }

  return {
    state: {
      ...state,
      phase: 'countdown',
      round: { goAt, endsAt },
      notice: null,
      modeState: mode.startRound(modeState, goAt, config, state.settings),
    },
    events: [{ type: 'phaseChanged', phase: 'countdown' }],
  };
}

function input(
  state: RoomState,
  command: InputCommand,
  now: number,
  config: GameConfig,
): ApplyResult {
  const player = state.players[command.playerId];
  if (player === undefined) return reject(state, command.playerId, 'not_joined');
  // Input outside a round is not an error: the client may not know it ended yet.
  if (state.phase !== 'running') return { state, events: [] };

  const modeState = modeFor(state.mode).applyInput(
    state.modeState,
    player.publicId,
    command.input,
    now,
    config,
    state.settings,
  );
  // The mode returns the same reference when nothing changed — a refused click, for instance.
  // Keep that identity: callers rely on it to skip broadcasting a snapshot that is not new.
  if (modeState === state.modeState) return { state, events: [] };

  return { state: { ...state, modeState }, events: [] };
}
