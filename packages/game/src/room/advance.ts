import * as mode from '../modes/clicker';
import type { GameConfig } from './config';
import type { Phase, RoomState } from './state';

export interface AdvanceResult {
  state: RoomState;
  /** Phases entered, in order. */
  phases: Phase[];
}

/** publicId → name, the only thing the mode needs from the room to build results. */
function names(state: RoomState): Record<string, string> {
  const result: Record<string, string> = {};
  for (const player of Object.values(state.players)) result[player.publicId] = player.name;
  return result;
}

/**
 * Moves the state through time. Runs before every command, so the rules do not
 * depend on the alarm being punctual.
 */
export function advance(state: RoomState, now: number, config: GameConfig): AdvanceResult {
  let next = state;
  const phases: Phase[] = [];

  for (;;) {
    if (next.phase === 'countdown' && next.round !== null && now >= next.round.goAt) {
      next = { ...next, phase: 'running' };
      phases.push('running');
      continue;
    }
    if (
      next.phase === 'running' &&
      next.round !== null &&
      now >= next.round.endsAt + config.lateGraceMs
    ) {
      next = {
        ...next,
        phase: 'results',
        round: null,
        modeState: mode.finish(next.modeState, names(next)),
      };
      phases.push('results');
      continue;
    }
    break;
  }

  return { state: removeExpired(next, now, config), phases };
}

/** Disconnected players are dropped outside a round only: their score matters while it runs. */
function removeExpired(state: RoomState, now: number, config: GameConfig): RoomState {
  if (state.phase !== 'lobby' && state.phase !== 'results') return state;

  const expired = Object.entries(state.players)
    .filter(
      ([, player]) =>
        player.connectionIds.length === 0 &&
        player.disconnectedAt !== null &&
        player.disconnectedAt + config.reconnectGraceMs <= now,
    )
    .map(([playerId]) => playerId);

  if (expired.length === 0) return state;

  const players = { ...state.players };
  const publicIds: string[] = [];
  for (const playerId of expired) {
    const player = players[playerId];
    if (player !== undefined) publicIds.push(player.publicId);
    delete players[playerId];
  }

  return {
    ...state,
    players,
    hosts: state.hosts.filter((playerId) => !expired.includes(playerId)),
    modeState: mode.removePlayers(state.modeState, publicIds),
  };
}
