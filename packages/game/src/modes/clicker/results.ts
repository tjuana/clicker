import type { ClickerScore, ResultRow } from './state';

/** Public ids are decimal strings, so they compare as numbers. */
export function comparePublicIds(a: string, b: string): number {
  return Number(a) - Number(b);
}

/**
 * More clicks wins. On a tie the player who reached that score first wins.
 * A full tie falls back to publicId so the order is predictable.
 */
function compare(a: ResultRow, b: ResultRow, scores: Record<string, ClickerScore>): number {
  if (a.clicks !== b.clicks) return b.clicks - a.clicks;
  const aTime = scores[a.publicId]?.lastCountedAt ?? Number.POSITIVE_INFINITY;
  const bTime = scores[b.publicId]?.lastCountedAt ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return comparePublicIds(a.publicId, b.publicId);
}

/** `names` maps publicId to the player's name: the room owns names, the mode owns scores. */
export function computeResults(
  scores: Record<string, ClickerScore>,
  names: Record<string, string>,
): ResultRow[] {
  return Object.entries(scores)
    .map(([publicId, score]) => ({
      publicId,
      name: names[publicId] ?? '',
      clicks: score.clicks,
      rank: 0,
    }))
    .sort((a, b) => compare(a, b, scores))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
