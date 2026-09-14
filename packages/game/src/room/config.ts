export interface GameConfig {
  /** Countdown before the round. */
  countdownMs: number;
  /** Round length. */
  roundMs: number;
  /** How long clicks are still accepted after the round ends: slack for network delay. */
  lateGraceMs: number;
  /** Token bucket refill rate. */
  clicksPerSecond: number;
  /** Token bucket capacity. */
  burst: number;
  /** How long a disconnected player stays in the list. */
  reconnectGraceMs: number;
  /** Maximum players in a room. */
  maxPlayers: number;
  /**
   * How often the room advances time on its own during a round.
   * `null` — only commands and the alarm move it: that is the clicker, it has nowhere to move.
   * A number — the simulation step in milliseconds: a snake has to keep crawling while nobody types.
   */
  tickMs: number | null;
}

export const DEFAULT_CONFIG: GameConfig = {
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  clicksPerSecond: 15,
  burst: 15,
  reconnectGraceMs: 30000,
  maxPlayers: 50,
  tickMs: null,
};
