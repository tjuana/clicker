/** What the clicker counts for one player. Keyed by publicId, like everything the mode shows. */
export interface ClickerScore {
  clicks: number;
  /** Time of the last counted click: it breaks ties. */
  lastCountedAt: number | null;
  bucket: { tokens: number; updatedAt: number };
}

export interface ResultRow {
  publicId: string;
  name: string;
  clicks: number;
  rank: number;
}

export interface ClickerState {
  scores: Record<string, ClickerScore>;
  results: ResultRow[] | null;
}

/** The clicker's own input. Pressing the button is the whole of it. */
export type ClickerInput = { type: 'click' };

export function createClickerState(): ClickerState {
  return { scores: {}, results: null };
}

export function emptyScore(now: number, burst: number): ClickerScore {
  return { clicks: 0, lastCountedAt: null, bucket: { tokens: burst, updatedAt: now } };
}
