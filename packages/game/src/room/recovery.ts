import { modeFor } from '../modes';
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
    modeState: modeFor(state.mode).clear(state.modeState),
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
  for (const [playerId, stored] of Object.entries(state.players)) {
    // What storage hands back was written by an older build and may lack the flag. Every stored
    // room passes through here when the object starts, so this is where it becomes a boolean.
    const player: Omit<Player, 'bot'> & { bot?: boolean } = stored;
    // A bot has no connection to recount; counting it as disconnected would expire it.
    if (player.bot === true) {
      players[playerId] = stored;
      continue;
    }
    const connectionIds = live[playerId] ?? [];
    players[playerId] = {
      ...player,
      bot: false,
      connectionIds,
      disconnectedAt: connectionIds.length > 0 ? null : (player.disconnectedAt ?? now),
    };
  }
  return { ...state, players };
}
