import { DEFAULT_CONFIG, type GameConfig } from './config';
import type { RoomState } from './state';

/**
 * Ближайший момент, когда состояние должно измениться само.
 * Сервер ставит на него будильник Durable Object.
 */
export function nextDeadline(state: RoomState, config: GameConfig = DEFAULT_CONFIG): number | null {
  const candidates: number[] = [];

  if (state.phase === 'countdown' && state.round !== null) {
    candidates.push(state.round.goAt);
  }
  if (state.phase === 'running' && state.round !== null) {
    candidates.push(state.round.endsAt + config.lateGraceMs);
  }
  if (state.phase === 'lobby' || state.phase === 'results') {
    for (const player of Object.values(state.players)) {
      if (player.connectionIds.length === 0 && player.disconnectedAt !== null) {
        candidates.push(player.disconnectedAt + config.reconnectGraceMs);
      }
    }
  }

  return candidates.length === 0 ? null : Math.min(...candidates);
}
