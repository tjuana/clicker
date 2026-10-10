import { modeFor } from '../modes';
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
    case 'step':
      return { state, events: [] };
    case 'setMode':
      return setMode(state, command, now, config);
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

  // Seated in publicId order, so a slot means the same thing however the room lists its players.
  let modeState = next.create(now | 0);
  const seated = Object.values(players).sort((a, b) => comparePublicIds(a.publicId, b.publicId));
  for (const player of seated) {
    modeState = next.addPlayer(modeState, player.publicId, player.bot, now, config);
  }

  return { state: { ...state, mode: command.mode, players, modeState }, events: [] };
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
      modeState: mode.addPlayer(state.modeState, publicId, true, now, config),
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
    modeState = modeFor(state.mode).addPlayer(state.modeState, publicId, false, now, config);
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

  return {
    state: withPlayer(state, playerId, {
      ...player,
      connectionIds,
      disconnectedAt:
        connectionIds.length === 0 && player.disconnectedAt === null ? now : player.disconnectedAt,
    }),
    events: [],
  };
}

function start(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  if (state.players[playerId] === undefined) return reject(state, playerId, 'not_joined');
  if (!state.hosts.includes(playerId)) return reject(state, playerId, 'not_host');
  if (state.phase !== 'lobby' && state.phase !== 'results')
    return reject(state, playerId, 'wrong_phase');

  const goAt = now + config.countdownMs;
  const endsAt = goAt + config.roundMs;

  return {
    state: {
      ...state,
      phase: 'countdown',
      round: { goAt, endsAt },
      notice: null,
      modeState: modeFor(state.mode).startRound(state.modeState, goAt, config),
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
  );
  // The mode returns the same reference when nothing changed — a refused click, for instance.
  // Keep that identity: callers rely on it to skip broadcasting a snapshot that is not new.
  if (modeState === state.modeState) return { state, events: [] };

  return { state: { ...state, modeState }, events: [] };
}
