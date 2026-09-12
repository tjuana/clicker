import type { Player, ResultRow } from './state';

/**
 * Больше кликов — выше. При равенстве выигрывает тот, кто набрал счёт раньше.
 * Полная ничья разбивается по publicId, чтобы порядок был предсказуемым.
 */
function compare(a: Player, b: Player): number {
  if (a.clicks !== b.clicks) return b.clicks - a.clicks;
  const aTime = a.lastCountedAt ?? Number.POSITIVE_INFINITY;
  const bTime = b.lastCountedAt ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return Number(a.publicId) - Number(b.publicId);
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
