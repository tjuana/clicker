import type { ModeId } from '../modes';
import { DEFAULT_SPEED, type Speed } from '../modes/cycles/config';
import { RACE } from '../modes/race/config';

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
  /**
   * How long a living round waits for a person to come back once no person is connected. Longer
   * than a socket needs to reconnect after a blip, far shorter than a round: past it the bots
   * would be playing to an empty room.
   */
  desertedGraceMs: number;
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
  desertedGraceMs: 10_000,
  maxPlayers: 50,
  tickMs: null,
};

/** How much longer than the race's cap the room's clock waits before it ends a race itself. */
const RACE_CLOCK_MARGIN_MS = 10_000;

/** What a mode changes about the room. Anything not named here comes from DEFAULT_CONFIG. */
export const MODE_CONFIG: Record<ModeId, Partial<GameConfig>> = {
  clicker: {},
  // No `tickMs`: the light cycles take one cell per tick, so the speed decides it (`configFor`).
  cycles: { roundMs: 180_000, maxPlayers: 20 },
  // The round's length is only the race's cap: it ends itself well before (`Mode.over`). The
  // cap is counted in ticks and the room's clock in milliseconds, and a tick that runs late
  // must not be cut short by a clock that did not: hence the margin.
  race: {
    roundMs: Math.ceil((RACE.cap * 1000) / RACE.ticksPerSecond) + RACE_CLOCK_MARGIN_MS,
    maxPlayers: 20,
    tickMs: 1000 / RACE.ticksPerSecond,
  },
};

/** The time between ticks of a light-cycle room: one cell per tick, so it is the time a cell takes. */
export function tickMsFor(speed: Speed): number {
  return 1000 / speed;
}

/** What a mode changes about the room, and the pace the host chose for the light cycles. */
export function configFor(
  mode: ModeId,
  base: GameConfig = DEFAULT_CONFIG,
  speed: Speed = DEFAULT_SPEED,
): GameConfig {
  return {
    ...base,
    ...MODE_CONFIG[mode],
    ...(mode === 'cycles' ? { tickMs: tickMsFor(speed) } : {}),
  };
}
