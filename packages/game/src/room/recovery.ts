import * as mode from '../modes/clicker';
import type { Player, RoomState } from './state';

/**
 * The round is over before it ended: the server restarted and the in-memory clicks are gone.
 * Only from countdown or running — anywhere else the state comes back untouched.
 */
export function abortRound(state: RoomState): RoomState {
  if (state.phase !== 'countdown' && state.phase !== 'running') return state;

  return {
    ...state,
    phase: 'lobby',
    round: null,
    notice: 'round_aborted',
    modeState: mode.clearScores(state.modeState),
  };
}

/**
 * Recounts the connections after the server wakes up or restarts.
 * `live` holds the ids of the connections each playerId has right now.
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
