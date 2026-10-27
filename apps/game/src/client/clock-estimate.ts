/** What the network adds to a message on top of its fastest trip: the measured p99 is 57 ms. */
const JITTER_MS = 60;

/**
 * How far in the past the scene draws the world. A bike is drawn riding from its head of tick t to
 * the head of t + 1, so the next tick has to be here before the ride starts: a whole tick of delay
 * for that, and the network's jitter on top so a late message is still in time. A fixed delay is
 * shorter than a tick at the slowest speed, and the bike then froze and jumped on a fifth of the
 * frames.
 */
export const renderDelay = (tickMs: number): number => tickMs + JITTER_MS;

/**
 * How far back the estimate of the server's clock looks. It is also how long a stale estimate can
 * outlive a server that stalled: the old minimum is forgotten once it is this old.
 */
const WINDOW_MS = 4_000;
/** Twenty ticks a second is the fastest a room runs: eighty arrivals fit in the window, and room to spare. */
const CAPACITY = 128;

export interface ClockEstimate {
  /** The delta of `tick` arrived at local time `now`. */
  observe: (tick: number, now: number) => void;
  /** Whether a delta has been seen: before that there is no clock to read. */
  started: () => boolean;
  /** The local time at which the server stepped tick 0, as far as the arrivals tell. */
  base: () => number;
}

/**
 * A tick is stepped on the server at `base + tick × tickMs`, and the network only ever adds to
 * that, so the arrival that was delayed least — the minimum of `arrival − tick × tickMs` over the
 * last few seconds — is the best estimate of `base`.
 *
 * Only deltas should be observed. A full is sent when the countdown starts, three seconds before
 * tick 1 is stepped, so as the minimum it put the clock a whole countdown ahead and nothing
 * moved until it was forgotten.
 *
 * The minimum is a plain scan of at most 128 numbers per arrival, eight to twenty times a second:
 * a monotonic deque would be less code to get wrong, but no less to read.
 */
export function createClockEstimate(tickMs: number): ClockEstimate {
  const offsets = new Float64Array(CAPACITY);
  const arrivals = new Float64Array(CAPACITY);
  let seen = 0;
  let base = 0;
  return {
    observe: (tick, now) => {
      offsets[seen % CAPACITY] = now - tick * tickMs;
      arrivals[seen % CAPACITY] = now;
      seen += 1;
      base = Number.POSITIVE_INFINITY;
      for (let i = 0; i < Math.min(seen, CAPACITY); i += 1) {
        if (now - (arrivals[i] as number) <= WINDOW_MS) base = Math.min(base, offsets[i] as number);
      }
    },
    started: () => seen > 0,
    base: () => base,
  };
}
