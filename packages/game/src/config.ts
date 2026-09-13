export interface GameConfig {
  /** Duration of the countdown before a round. */
  countdownMs: number;
  /** Duration of a round. */
  roundMs: number;
  /** How much longer we keep accepting clicks after the round ends: slack for network latency. */
  lateGraceMs: number;
  /** Refill rate of the token bucket. */
  clicksPerSecond: number;
  /** Capacity of the token bucket. */
  burst: number;
  /** How long a disconnected player stays in the list. */
  reconnectGraceMs: number;
  /** Maximum number of players in a room. */
  maxPlayers: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  countdownMs: 3000,
  roundMs: 10000,
  lateGraceMs: 250,
  clicksPerSecond: 15,
  burst: 15,
  reconnectGraceMs: 30000,
  maxPlayers: 50,
};
