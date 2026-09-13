import type { GameConfig } from './config';
import { computeResults } from './results';
import type { Phase, RoomState } from './state';

export interface AdvanceResult {
  state: RoomState;
  /** Phases that were entered, in order. */
  phases: Phase[];
}

/**
 * Advances the state through time. Called before handling any command,
 * so the rules never depend on whether the alarm fired on time.
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
      next = { ...next, phase: 'results', round: null, results: computeResults(next.players) };
      phases.push('results');
      continue;
    }
    break;
  }

  return { state: removeExpired(next, now, config), phases };
}

/** Disconnected players are only removed outside a round: during a round their score is still needed. */
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
  for (const playerId of expired) delete players[playerId];

  return {
    ...state,
    players,
    hosts: state.hosts.filter((playerId) => !expired.includes(playerId)),
  };
}
