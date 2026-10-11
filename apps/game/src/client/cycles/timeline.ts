import type { DeltaMessage } from '@clicker/protocol';
import type { Head, WallOp } from './model';

/** The scene draws the world this far in the past: it covers the measured p99 network jitter. */
export const RENDER_DELAY_MS = 100;
/** Heads kept for interpolation. */
export const KEPT_TICKS = 16;
/** Arrivals the estimate of the server's clock looks back over: about eight seconds at 8 a second. */
const WINDOW = 64;

/** What a frame with nothing to show gets: the scene asks sixty times a second. */
const NONE: Step[] = [];

/** Everything one message changed, to be shown when its tick comes. */
export interface Step {
  tick: number;
  walls: WallOp[];
  heads: Map<number, Head>;
  events: DeltaMessage['events'];
  /** A full: the scene clears its walls before laying these. */
  reset: boolean;
}

/** The heads either side of the render tick, and how far between them it is (0…1). */
export interface Sample {
  from: Map<number, Head>;
  to: Map<number, Head>;
  alpha: number;
}

export interface Timeline {
  /** The message of `step.tick` arrived at local time `now`. Ticks arrive consecutively. */
  arrive: (step: Step, now: number) => void;
  /** The tick the scene should draw at `now`, fractional; never goes backwards. */
  renderTick: (now: number) => number;
  /**
   * Takes the steps whose tick the render clock has reached, oldest first. With `ahead` ticks of
   * lead it takes those that many ticks early: a bike is drawn riding from its head of tick t to
   * the head of t + 1, so its wall has to be laid to t + 1 already, or the trail would stop short
   * of the bike by the distance it has covered.
   */
  release: (now: number, ahead?: number) => Step[];
  /** `null` until the first message. */
  sample: (now: number) => Sample | null;
}

/**
 * Places ticks in time. A tick is stepped on the server at `base + tick × tickMs`, and the network
 * only ever adds to that, so the arrival that was delayed least — the minimum of
 * `arrival − tick × tickMs` over recent arrivals — is the best estimate of `base`. The scene then
 * draws `RENDER_DELAY_MS` behind it, so a tick that is a little late is still on time, and a burst
 * of ticks that the network held back comes out at the pace it was stepped, not all at once.
 *
 * The minimum is taken over a plain scan of 64 numbers per arrival, eight to twenty times a
 * second: a monotonic deque would be less code to get wrong, but no less to read.
 */
export function createTimeline(tickMs: number): Timeline {
  const offsets = new Float64Array(WINDOW);
  let seen = 0;
  let base = 0;
  /** Steps in tick order with no gaps: the model refuses anything else before it gets here. */
  const steps: Step[] = [];
  let released = Number.NEGATIVE_INFINITY;
  // The estimate can drift upward when an old minimum leaves the window; stalling beats rewinding.
  let latest = Number.NEGATIVE_INFINITY;

  const renderTick = (now: number): number => {
    if (seen === 0) return Number.NEGATIVE_INFINITY;
    latest = Math.max(latest, (now - base - RENDER_DELAY_MS) / tickMs);
    return latest;
  };

  return {
    arrive: (step, now) => {
      offsets[seen % WINDOW] = now - step.tick * tickMs;
      seen += 1;
      base = Number.POSITIVE_INFINITY;
      for (let i = 0; i < Math.min(seen, WINDOW); i += 1)
        base = Math.min(base, offsets[i] as number);
      steps.push(step);
    },
    renderTick,
    release: (now, ahead = 0) => {
      const reached = renderTick(now) + ahead;
      const first = steps[0];
      if (first === undefined) return NONE;
      const out: Step[] = [];
      for (let i = Math.max(0, released + 1 - first.tick); i < steps.length; i += 1) {
        const step = steps[i] as Step;
        if (step.tick > reached) break;
        out.push(step);
        released = step.tick;
      }
      // Only what has been shown may go: an unreleased step carries walls nobody has laid yet.
      while (steps.length > KEPT_TICKS && (steps[0] as Step).tick < released) steps.shift();
      return out.length === 0 ? NONE : out;
    },
    sample: (now) => {
      const first = steps[0];
      const last = steps.at(-1);
      if (first === undefined || last === undefined) return null;
      const at = renderTick(now);
      const index = Math.floor(at) - first.tick;
      if (index < 0) return { from: first.heads, to: first.heads, alpha: 0 };
      if (index >= steps.length - 1) return { from: last.heads, to: last.heads, alpha: 0 };
      return {
        from: (steps[index] as Step).heads,
        to: (steps[index + 1] as Step).heads,
        alpha: at - Math.floor(at),
      };
    },
  };
}
