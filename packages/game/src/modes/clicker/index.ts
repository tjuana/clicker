import type { GameConfig } from '../../room/config';
import { computeResults } from './results';
import { type ClickerInput, type ClickerState, emptyScore } from './state';

export { comparePublicIds, computeResults } from './results';
export {
  type ClickerInput,
  type ClickerScore,
  type ClickerState,
  createClickerState,
  type ResultRow,
} from './state';

/**
 * The single door between the room and this game.
 * The room calls these and knows nothing else about clicking; when a second mode
 * appears, this shape is what becomes an interface — derived from two implementations, not one.
 */

export function addPlayer(
  state: ClickerState,
  publicId: string,
  now: number,
  config: GameConfig,
): ClickerState {
  return { ...state, scores: { ...state.scores, [publicId]: emptyScore(now, config.burst) } };
}

export function removePlayers(state: ClickerState, publicIds: string[]): ClickerState {
  if (publicIds.length === 0) return state;
  const scores = { ...state.scores };
  for (const publicId of publicIds) delete scores[publicId];
  return { ...state, scores };
}

/** A new round wipes the scores: the previous one must not leak into it. */
export function startRound(state: ClickerState, goAt: number, config: GameConfig): ClickerState {
  const scores: ClickerState['scores'] = {};
  for (const publicId of Object.keys(state.scores)) {
    scores[publicId] = emptyScore(goAt, config.burst);
  }
  return { scores, results: null };
}

export function applyInput(
  state: ClickerState,
  publicId: string,
  _input: ClickerInput,
  now: number,
  config: GameConfig,
): ClickerState {
  const score = state.scores[publicId];
  if (score === undefined) return state;

  const elapsed = Math.max(0, now - score.bucket.updatedAt);
  const tokens = Math.min(
    config.burst,
    score.bucket.tokens + (elapsed * config.clicksPerSecond) / 1000,
  );
  // Not enough tokens: change nothing at all, so a stale timestamp cannot rewind the anchor.
  if (tokens < 1) return state;

  return {
    ...state,
    scores: {
      ...state.scores,
      [publicId]: {
        clicks: score.clicks + 1,
        lastCountedAt: now,
        bucket: { tokens: tokens - 1, updatedAt: Math.max(score.bucket.updatedAt, now) },
      },
    },
  };
}

/** `names` maps publicId to the player's name: the room owns names, the mode owns scores. */
export function finish(state: ClickerState, names: Record<string, string>): ClickerState {
  return { ...state, results: computeResults(state.scores, names) };
}

/** An interrupted round leaves no score behind: the lobby must not show it. */
export function clearScores(state: ClickerState): ClickerState {
  const scores: ClickerState['scores'] = {};
  for (const [publicId, score] of Object.entries(state.scores)) {
    scores[publicId] = { ...score, clicks: 0, lastCountedAt: null };
  }
  return { ...state, scores };
}

/** The mode's slot in the snapshot. Only public ids and numbers leave this function. */
export function toData(state: ClickerState): {
  scores: Record<string, number>;
  results: { id: string; name: string; clicks: number; rank: number }[] | null;
} {
  const scores: Record<string, number> = {};
  for (const [publicId, score] of Object.entries(state.scores)) scores[publicId] = score.clicks;

  return {
    scores,
    results:
      state.results === null
        ? null
        : state.results.map((row) => ({
            id: row.publicId,
            name: row.name,
            clicks: row.clicks,
            rank: row.rank,
          })),
  };
}
