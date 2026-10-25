import { modeFor } from '../modes';
import { type CyclesSettings, DEFAULT_CYCLES_SETTINGS } from '../modes/cycles/config';
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
    modeState: modeFor(state.mode).clear(state.modeState, state.settings),
  };
}

/**
 * What storage hands back was written by an older build and may lack what this one reads: the
 * room's settings (a speed alone, or nothing) and the players' bot flag. It runs first thing
 * after the read, because everything after it, `abortRound` included, trusts the shape.
 */
export function upgradeStored(state: RoomState): RoomState {
  const stored = state as Omit<RoomState, 'settings'> & {
    settings?: CyclesSettings;
    speed?: CyclesSettings['speed'];
  };
  const settings: CyclesSettings = stored.settings ?? {
    ...DEFAULT_CYCLES_SETTINGS,
    speed: stored.speed ?? DEFAULT_CYCLES_SETTINGS.speed,
  };
  const players: Record<string, Player> = {};
  for (const [playerId, player] of Object.entries(state.players)) {
    const old: Omit<Player, 'bot'> & { bot?: boolean } = player;
    players[playerId] = { ...player, bot: old.bot === true };
  }
  return { ...state, players, settings };
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
    // A bot has no connection to recount; counting it as disconnected would expire it.
    if (player.bot) {
      players[playerId] = player;
      continue;
    }
    const connectionIds = live[playerId] ?? [];
    players[playerId] = {
      ...player,
      connectionIds,
      disconnectedAt: connectionIds.length > 0 ? null : (player.disconnectedAt ?? now),
    };
  }
  return { ...state, players };
}
