import type { Player, RoomState } from './state';

/**
 * Раунд прерван: сервер перезапустился и клики из памяти потеряны.
 */
export function abortRound(state: RoomState): RoomState {
  return { ...state, phase: 'lobby', round: null, notice: 'round_aborted' };
}

/**
 * Пересчёт соединений после пробуждения или перезапуска сервера.
 * `live` — id живых соединений сейчас у каждого playerId.
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
