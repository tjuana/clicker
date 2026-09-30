export interface GameConfig {
  /** Countdown before the round. */
  countdownMs: number;
  /** Round length. */
  roundMs: number;
  /** How long clicks are still accepted after the round ends: slack for network delay. */
  lateGraceMs: number;
  /**
   * Token bucket refill rate. Set well above what hands can do: the bucket is there to stop a
   * script writing itself ten thousand clicks, not to cap a fast player. A ceiling a human can
   * reach turns close rounds into draws — a real team round ended tied on exactly that.
   */
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
  // Two hands manage about twenty a second; thirty is safely past anything human.
  clicksPerSecond: 30,
  burst: 30,
  reconnectGraceMs: 30000,
  maxPlayers: 50,
  tickMs: null,
};
