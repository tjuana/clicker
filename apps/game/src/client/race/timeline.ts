import { TURN } from '@clicker/game';
import { createClockEstimate, renderDelay } from '../clock-estimate';
import type { RaceModel } from './model';

/**
 * Ticks kept. The scene draws one tick and a jitter allowance behind the newest, at most three or
 * four ticks at the race's pace, so sixteen leaves room for a burst of late messages. A ring: the
 * oldest is overwritten, nothing grows however long the race.
 */
export const RING_TICKS = 16;
/** A car's slot indexes the tables below. The room seats twenty; a slot beyond this is not drawn. */
export const MAX_SLOTS = 64;
/** x, y, heading, speed, lap, flags. */
const STRIDE = 6;

interface Entry {
  tick: number;
  count: number;
  /** Slots in race order, `count` of them. */
  order: Uint8Array;
  /** Whether the slot is in this tick. */
  present: Uint8Array;
  /** `slot × STRIDE`. All integers, as on the wire. */
  data: Int32Array;
}

/** A car between two ticks. Reused by `sample`: read it, do not keep it. */
export interface SampledCar {
  slot: number;
  x: number;
  y: number;
  /** 0 ≤ heading < TURN, turned the short way round between the two ticks. */
  heading: number;
  speed: number;
  lap: number;
  flags: number;
  /** How far between its two ticks it is drawn, 0…1; 1 for a car the older tick did not have. */
  alpha: number;
}

export interface Sample {
  /** How far between the two ticks the render time is, 0…1. */
  alpha: number;
  /** Cars in the order of the race at the newer tick: `cars[0..count)`. */
  count: number;
  cars: SampledCar[];
}

export interface RaceTimeline {
  /**
   * The state of `model.tick` arrived at local time `now`. A delta places the clock; a full is
   * only a place to stand, and for the first message the timeline shows it as it is.
   */
  arrive: (model: RaceModel, now: number, delta: boolean) => void;
  /** The tick the scene should draw at `now`, fractional; never goes backwards. */
  renderTick: (now: number) => number;
  /** `null` until the first message. Allocates nothing: the same objects every time. */
  sample: (now: number) => Sample | null;
  /** Ticks held; never more than `RING_TICKS`. */
  held: () => number;
}

/** The difference `to − from` the short way round a turn, in (−TURN/2, TURN/2]. */
export function turnBetween(from: number, to: number): number {
  const d = (((to - from) % TURN) + TURN) % TURN;
  return d > TURN / 2 ? d - TURN : d;
}

function entry(): Entry {
  return {
    tick: 0,
    count: 0,
    order: new Uint8Array(MAX_SLOTS),
    present: new Uint8Array(MAX_SLOTS),
    data: new Int32Array(MAX_SLOTS * STRIDE),
  };
}

/**
 * Places ticks in time and hands each car out between its two. The clock is the light cycles'
 * (`clock-estimate.ts`); the render time is one tick and the jitter allowance behind it, so the
 * newer tick of the pair is already here.
 */
export function createRaceTimeline(tickMs: number): RaceTimeline {
  const delay = renderDelay(tickMs);
  const clock = createClockEstimate(tickMs);
  const ring = Array.from({ length: RING_TICKS }, entry);
  /** Index of the newest entry; `length` of them are live, oldest first behind it. */
  let newest = -1;
  let length = 0;
  let latest = Number.NEGATIVE_INFINITY;
  const out: Sample = {
    alpha: 0,
    count: 0,
    cars: Array.from({ length: MAX_SLOTS }, () => ({
      slot: 0,
      x: 0,
      y: 0,
      heading: 0,
      speed: 0,
      lap: 0,
      flags: 0,
      alpha: 0,
    })),
  };

  /** The `n`-th live entry, 0 = oldest. */
  const nth = (n: number): Entry =>
    ring[(newest - length + 1 + n + 2 * RING_TICKS) % RING_TICKS] as Entry;

  const renderTick = (now: number): number => {
    if (!clock.started() || length === 0) return Number.NEGATIVE_INFINITY;
    // Never past the newest tick there is: a clock ahead of the data cannot go back, and the cars
    // would stand still while real time caught up.
    const top = (ring[newest] as Entry).tick;
    latest = Math.max(latest, Math.min((now - clock.base() - delay) / tickMs, top));
    return latest;
  };

  const place = (car: SampledCar, slot: number, to: Entry, from: Entry | null, alpha: number) => {
    const t = slot * STRIDE;
    const f = from !== null && from.present[slot] === 1 ? from : null;
    const a = f === null ? 1 : alpha;
    const mix = (k: number): number => {
      const end = to.data[t + k] as number;
      return f === null ? end : (f.data[t + k] as number) + (end - (f.data[t + k] as number)) * a;
    };
    car.slot = slot;
    car.x = mix(0);
    car.y = mix(1);
    const h0 = f === null ? (to.data[t + 2] as number) : (f.data[t + 2] as number);
    const h = h0 + turnBetween(h0, to.data[t + 2] as number) * a;
    car.heading = ((h % TURN) + TURN) % TURN;
    car.speed = mix(3);
    car.lap = to.data[t + 4] as number;
    car.flags = to.data[t + 5] as number;
    car.alpha = a;
  };

  return {
    arrive: (model, now, delta) => {
      if (delta) clock.observe(model.tick, now);
      // A full for the tick the newest entry already holds replaces it; anything else is next.
      if (length === 0 || (ring[newest] as Entry).tick !== model.tick) {
        newest = (newest + 1) % RING_TICKS;
        length = Math.min(length + 1, RING_TICKS);
      }
      const e = ring[newest] as Entry;
      e.tick = model.tick;
      e.present.fill(0);
      e.count = 0;
      for (const slot of model.order) {
        const car = model.cars.get(slot);
        if (car === undefined || slot >= MAX_SLOTS) continue;
        const t = slot * STRIDE;
        e.data[t] = car.x;
        e.data[t + 1] = car.y;
        e.data[t + 2] = car.heading;
        e.data[t + 3] = car.speed;
        e.data[t + 4] = car.lap;
        e.data[t + 5] = car.flags;
        e.present[slot] = 1;
        e.order[e.count] = slot;
        e.count += 1;
      }
    },
    renderTick,
    held: () => length,
    sample: (now) => {
      if (length === 0) return null;
      const last = nth(length - 1);
      const at = renderTick(now);
      // Before the clock has started (only a full has come) the cars stand as that full has them.
      let from: Entry | null = null;
      let to = last;
      let alpha = 1;
      if (at !== Number.NEGATIVE_INFINITY && at < last.tick) {
        // The newest pair of entries around `at`; a gap in the ticks stretches the pair.
        let i = length - 1;
        while (i > 0 && nth(i - 1).tick >= at) i -= 1;
        to = nth(i);
        if (i === 0) {
          alpha = 1;
        } else {
          from = nth(i - 1);
          alpha = Math.min(1, Math.max(0, (at - from.tick) / (to.tick - from.tick)));
        }
      }
      out.alpha = alpha;
      out.count = to.count;
      for (let k = 0; k < to.count; k += 1) {
        place(out.cars[k] as SampledCar, to.order[k] as number, to, from, alpha);
      }
      return out;
    },
  };
}
