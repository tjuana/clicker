import type { Player, RoomState } from './state';

/**
 * The round was aborted: the server restarted and the clicks held in memory are lost.
 * Outside a round there's nothing to abort: the state is returned as is.
 */
export function abortRound(state: RoomState): RoomState {
  if (state.phase !== 'countdown' && state.phase !== 'running') return state;

  // There's no point showing the aborted round's score in the lobby.
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    players[playerId] = { ...player, clicks: 0, lastCountedAt: null };
  }

  return { ...state, phase: 'lobby', round: null, notice: 'round_aborted', players };
}

/**
 * Recomputes connections after the server wakes up or restarts.
 * `live` is the ids of each playerId's currently live connections.
 */
export function syncConnections(
  state: RoomState,
  live: Record<string, string[]>,
  now: number,
): RoomState {
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    const connectionIds = live[playerId] ?? [];
    players[playerId] = {
      ...player,
      connectionIds,
      disconnectedAt: connectionIds.length > 0 ? null : (player.disconnectedAt ?? now),
    };
  }
  return { ...state, players };
}
