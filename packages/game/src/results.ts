import type { Player, ResultRow } from './state';

/** publicId is a number in a string: '2' comes before '10', not the other way around. */
export function comparePublicIds(a: string, b: string): number {
  return Number(a) - Number(b);
}

/**
 * More clicks ranks higher. On a tie, whoever reached that score first wins.
 * A complete tie is broken by publicId, so the order stays predictable.
 */
function compare(a: Player, b: Player): number {
  if (a.clicks !== b.clicks) return b.clicks - a.clicks;
  const aTime = a.lastCountedAt ?? Number.POSITIVE_INFINITY;
  const bTime = b.lastCountedAt ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return comparePublicIds(a.publicId, b.publicId);
}

export function computeResults(players: Record<string, Player>): ResultRow[] {
  return Object.values(players)
    .sort(compare)
    .map((player, index) => ({
      publicId: player.publicId,
      name: player.name,
      clicks: player.clicks,
      rank: index + 1,
    }));
}
