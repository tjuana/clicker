import { modeFor } from '../modes';
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
 * A living round with nobody watching: only bots would be left playing to an empty room, and
 * the Durable Object would tick for them until the clock ran out. The clicker is not affected —
 * its score does not depend on anyone still being there.
 *
 * "Nobody" means every person has been gone for the whole grace: a network blip closes the
 * socket for a moment, and ending a solo round at the first step after it would punish that.
 *
 * Stops at the first connected person, so the common case — the host is there — reads one
 * player, not the whole room, on every command.
 */
function deserted(state: RoomState, now: number, config: GameConfig): boolean {
  if (modeFor(state.mode).step === null) return false;
  for (const playerId in state.players) {
    const player = state.players[playerId];
    if (player === undefined || player.bot) continue;
    if (player.connectionIds.length > 0) return false;
    if (player.disconnectedAt === null || player.disconnectedAt + config.desertedGraceMs > now) {
      return false;
    }
  }
  return true;
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
      (now >= next.round.endsAt + config.lateGraceMs || deserted(next, now, config))
    ) {
      next = {
        ...next,
        phase: 'results',
        round: null,
        modeState: modeFor(next.mode).finish(next.modeState, names(next)),
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

  // A Set, because the hosts are filtered against it below: an array there would be a scan
  // per host, and in a room everyone has left both lists grow together.
  const expired = new Set<string>();
  for (const [playerId, player] of Object.entries(state.players)) {
    if (
      player.connectionIds.length === 0 &&
      player.disconnectedAt !== null &&
      player.disconnectedAt + config.reconnectGraceMs <= now
    ) {
      expired.add(playerId);
    }
  }

  if (expired.size === 0) return state;

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
    hosts: state.hosts.filter((playerId) => !expired.has(playerId)),
    modeState: modeFor(state.mode).removePlayers(state.modeState, publicIds),
  };
}
