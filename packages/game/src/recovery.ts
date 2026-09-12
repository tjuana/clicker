import type { Player, RoomState } from './state';

/**
 * Раунд прерван: сервер перезапустился и клики из памяти потеряны.
 */
export function abortRound(state: RoomState): RoomState {
  return { ...state, phase: 'lobby', round: null, notice: 'round_aborted' };
}

/**
 * Пересчёт числа соединений после пробуждения или перезапуска сервера.
 * `counts` — сколько живых соединений сейчас у каждого playerId.
 */
export function syncConnections(
  state: RoomState,
  counts: Record<string, number>,
  now: number,
): RoomState {
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    const connections = counts[playerId] ?? 0;
    players[playerId] = {
      ...player,
      connections,
      disconnectedAt: connections > 0 ? null : (player.disconnectedAt ?? now),
    };
  }
  return { ...state, players };
}
