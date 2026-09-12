import { advance } from './advance';
import type { Command, ErrorCode, GameEvent, JoinCommand, LeaveCommand } from './commands';
import { DEFAULT_CONFIG, type GameConfig } from './config';
import type { Player, RoomState } from './state';

export interface ApplyResult {
  state: RoomState;
  events: GameEvent[];
}

/**
 * Единственная точка изменения состояния комнаты.
 * Входное состояние не мутируется, время приходит параметром.
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
      return leave(state, command, now);
    case 'start':
      return start(state, command.playerId, now, config);
    case 'click':
      return click(state, command.playerId, now, config);
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
  let player: Player;

  if (existing !== undefined) {
    player = {
      ...existing,
      name: command.name,
      // Повторный join с того же соединения ничего не накручивает.
      connectionIds: existing.connectionIds.includes(command.connectionId)
        ? existing.connectionIds
        : [...existing.connectionIds, command.connectionId],
      disconnectedAt: null,
    };
  } else {
    if (Object.keys(state.players).length >= config.maxPlayers) {
      return reject(state, command.playerId, 'room_full');
    }
    player = {
      publicId: String(state.nextSeq),
      name: command.name,
      connectionIds: [command.connectionId],
      disconnectedAt: null,
      clicks: 0,
      lastCountedAt: null,
      bucket: { tokens: config.burst, updatedAt: now },
    };
    nextSeq = state.nextSeq + 1;
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
    state: { ...withPlayer(state, command.playerId, player), nextSeq, hostKey, hosts },
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

function leave(state: RoomState, command: LeaveCommand, now: number): ApplyResult {
  const player = state.players[command.playerId];
  if (player === undefined) return { state, events: [] };
  // Соединения нет в списке: лишний leave не трогает живые соединения.
  if (!player.connectionIds.includes(command.connectionId)) return { state, events: [] };

  const connectionIds = player.connectionIds.filter((id) => id !== command.connectionId);
  return {
    state: withPlayer(state, command.playerId, {
      ...player,
      connectionIds,
      // Уже проставленное время не обновляется: срок удаления не сдвигается.
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
  const players: Record<string, Player> = {};
  for (const [id, player] of Object.entries(state.players)) {
    players[id] = {
      ...player,
      clicks: 0,
      lastCountedAt: null,
      bucket: { tokens: config.burst, updatedAt: goAt },
    };
  }

  return {
    state: {
      ...state,
      phase: 'countdown',
      round: { goAt, endsAt },
      players,
      results: null,
      notice: null,
    },
    events: [{ type: 'phaseChanged', phase: 'countdown' }],
  };
}

function click(state: RoomState, playerId: string, now: number, config: GameConfig): ApplyResult {
  const player = state.players[playerId];
  if (player === undefined) return reject(state, playerId, 'not_joined');
  // Клик не в раунде — не ошибка: клиент мог не успеть узнать о конце.
  if (state.phase !== 'running') return { state, events: [] };

  const elapsed = Math.max(0, now - player.bucket.updatedAt);
  const tokens = Math.min(
    config.burst,
    player.bucket.tokens + (elapsed * config.clicksPerSecond) / 1000,
  );

  if (tokens < 1) {
    return {
      state: withPlayer(state, playerId, { ...player, bucket: { tokens, updatedAt: now } }),
      events: [],
    };
  }

  return {
    state: withPlayer(state, playerId, {
      ...player,
      clicks: player.clicks + 1,
      lastCountedAt: now,
      bucket: { tokens: tokens - 1, updatedAt: now },
    }),
    events: [],
  };
}
