import type { CyclesDeltaMessage } from '@clicker/protocol';
import { createClockEstimate, renderDelay } from '../clock-estimate';
import type { Head, WallOp } from './model';

export { renderDelay };

/** What a frame with nothing to show gets: the scene asks sixty times a second. */
const NONE: Step[] = [];

/** Everything one message changed, to be shown when its tick comes. */
export interface Step {
  tick: number;
  walls: WallOp[];
  heads: Map<number, Head>;
  events: CyclesDeltaMessage['events'];
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
  /**
   * The message of `step.tick` arrived at local time `now`. Ticks arrive consecutively; a full may
   * arrive at any time and replaces everything from its own tick on, the clock untouched.
   */
  arrive: (step: Step, now: number) => void;
  /** The tick the scene should draw at `now`, fractional; never goes backwards. */
  renderTick: (now: number) => number;
  /**
   * Takes the steps whose tick the render clock has reached, oldest first. With `ahead` ticks of
   * lead it takes those that many ticks early: a bike is drawn riding from its head of tick t to
   * the head of t + 1, so its wall has to be laid to t + 1 already, or the trail would stop short
   * of the bike by the distance it has covered. A full is not waited for: it is the field as it
   * stands, and before the first delta there is no clock to wait on.
   */
  release: (now: number, ahead?: number) => Step[];
  /**
   * Makes the next `release` start over from the latest full. For a scene that was built again
   * while the round went on: its walls are empty, and what was laid is in steps that were handed
   * out to the one before it. The steps are kept for as long as the round, about 13 MB for the
   * longest, twenty bikes for three minutes at the fastest speed, and gone with the timeline.
   */
  rewind: () => void;
  /** `null` until the first message. */
  sample: (now: number) => Sample | null;
}

/**
 * Places ticks in time. A tick is stepped on the server at `base + tick × tickMs`, and the network
 * only ever adds to that, so the arrival that was delayed least — the minimum of
 * `arrival − tick × tickMs` over the last few seconds — is the best estimate of `base`. The scene
 * then draws `renderDelay` behind it, so a tick that is a little late is still on time, and a burst
 * of ticks that the network held back comes out at the pace it was stepped, not all at once.
 *
 * Only deltas place the clock. A full is sent when the countdown starts, three seconds before
 * tick 1 is stepped, so as the minimum it put the clock a whole countdown ahead and nothing
 * moved until it was forgotten.
 *
 * The minimum is taken over a plain scan of at most 128 numbers per arrival, eight to twenty times
 * a second: a monotonic deque would be less code to get wrong, but no less to read.
 */
export function createTimeline(tickMs: number): Timeline {
  const delay = renderDelay(tickMs);
  const clock = createClockEstimate(tickMs);
  /** Steps in tick order with no gaps: the model refuses anything else before it gets here. */
  const steps: Step[] = [];
  /** Where the latest full is in `steps`: a late reader starts there, everything before is replaced by it. */
  let resetAt = 0;
  let released = Number.NEGATIVE_INFINITY;
  // The estimate can drift upward when an old minimum leaves the window; stalling beats running backwards.
  let latest = Number.NEGATIVE_INFINITY;

  const renderTick = (now: number): number => {
    const newest = steps.at(-1);
    if (!clock.started() || newest === undefined) return Number.NEGATIVE_INFINITY;
    // Never past the newest tick there is. A clock that ran ahead of the data, as one does after
    // a server stall until the old minimum is forgotten, would otherwise stay ahead for as long
    // as it was: it cannot go back, so the bike would stand still while real time caught up.
    latest = Math.max(latest, Math.min((now - clock.base() - delay) / tickMs, newest.tick));
    return latest;
  };

  return {
    arrive: (step, now) => {
      if (step.reset) {
        // The full is the field as it stands at its tick. What came before it stays to ride from,
        // unless a gap lies between: heads are not interpolated across ticks nobody saw.
        const first = steps[0];
        const kept = first === undefined ? 0 : step.tick - first.tick;
        steps.length = kept < 0 || kept > steps.length ? 0 : kept;
        // The scene may have laid a tick this one replaces; it lays the full when the clock gets there.
        released = Math.min(released, step.tick - 1);
        resetAt = steps.length;
      } else {
        clock.observe(step.tick, now);
      }
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
        if (step.tick > reached && !step.reset) break;
        out.push(step);
        released = step.tick;
      }
      return out.length === 0 ? NONE : out;
    },
    rewind: () => {
      const from = steps[resetAt];
      if (from !== undefined) released = from.tick - 1;
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
