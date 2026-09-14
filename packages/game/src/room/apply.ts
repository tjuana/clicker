import * as mode from '../modes/clicker';
import { advance } from './advance';
import type { Command, ErrorCode, GameEvent, InputCommand, JoinCommand } from './commands';
import { DEFAULT_CONFIG, type GameConfig } from './config';
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
    if (Object.keys(state.players).length >= config.maxPlayers) {
      return reject(state, command.playerId, 'room_full');
    }
    const publicId = String(state.nextSeq);
    player = {
      publicId,
      name: command.name,
      connectionIds: [command.connectionId],
      disconnectedAt: null,
    };
    nextSeq = state.nextSeq + 1;
    modeState = mode.addPlayer(state.modeState, publicId, now, config);
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
      modeState: mode.startRound(state.modeState, goAt, config),
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

  const modeState = mode.applyInput(state.modeState, player.publicId, command.input, now, config);
  // The mode returns the same reference when nothing changed — a refused click, for instance.
  // Keep that identity: callers rely on it to skip broadcasting a snapshot that is not new.
  if (modeState === state.modeState) return { state, events: [] };

  return { state: { ...state, modeState }, events: [] };
}
