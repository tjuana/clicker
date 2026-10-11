import { type DeltaMessage, type FullMessage, PROTOCOL_VERSION } from '@clicker/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCycles,
  feedCycles,
  followPhase,
  onRoundEvents,
  RESYNC_RETRY_MS,
  useCycles,
} from '../src/client/cycles/store';

const full = (
  tick: number,
  trail: number[] = [11, 12],
  over: Partial<FullMessage> = {},
): FullMessage => ({
  v: PROTOCOL_VERSION,
  type: 'full',
  tick,
  tickMs: 125,
  side: 10,
  ...over,
  bikes: [
    {
      slot: 1,
      id: '1',
      alive: true,
      dir: 0,
      trail,
      kills: 0,
      deaths: 0,
      rubber: 3,
      boost: 0,
      cooldown: 0,
      respawnIn: 0,
    },
  ],
});

/** A bike riding east along row 1: the head of tick t is at cell 12 + (t - 5). */
const delta = (t: number): DeltaMessage => ({
  v: PROTOCOL_VERSION,
  type: 'delta',
  t,
  cells: [12 + (t - 5), 1],
  heads: [1, 12 + (t - 5), 0, 3, 0],
  events: [],
});

describe('feeding the round to the client', () => {
  beforeEach(clearCycles);

  it('follows a full and the deltas after it', () => {
    expect(feedCycles(full(5), 0)).toBeNull();
    expect(feedCycles(delta(6), 125)).toBeNull();
    expect(feedCycles(delta(7), 250)).toBeNull();

    expect(useCycles.getState().model?.tick).toBe(7);
    expect(useCycles.getState().model?.heads.get(1)?.cell).toBe(14);
  });

  it('asks for the round once on a gap, and ignores deltas until the full comes', () => {
    feedCycles(full(5), 0);

    expect(feedCycles(delta(7), 250)).toBe('resync');
    expect(feedCycles(delta(8), 375)).toBeNull();
    expect(feedCycles(delta(9), 500)).toBeNull();
    expect(useCycles.getState().model?.tick).toBe(5);

    expect(feedCycles(full(9), 600)).toBeNull();
    expect(feedCycles(delta(10), 625)).toBeNull();
    expect(useCycles.getState().model?.tick).toBe(10);
  });

  it('asks again, never faster than the retry interval, while no full comes', () => {
    feedCycles(full(5), 0);
    expect(feedCycles(delta(7), 250)).toBe('resync');

    // Deltas keep arriving every 125 ms; none of them inside the interval asks again.
    let asked = [250];
    for (let t = 8, now = 375; now < 250 + 3 * RESYNC_RETRY_MS; t += 1, now += 125) {
      if (feedCycles(delta(t), now) === 'resync') asked.push(now);
    }

    expect(asked.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < asked.length; i += 1) {
      const gap = (asked[i] as number) - (asked[i - 1] as number);
      expect(gap).toBeGreaterThanOrEqual(RESYNC_RETRY_MS);
      // Late by at most one delta: the clock is the arrival of messages, not a timer.
      expect(gap).toBeLessThan(RESYNC_RETRY_MS + 125);
    }

    // The answer ends the asking.
    asked = [];
    expect(feedCycles(full(40), 6_000)).toBeNull();
    expect(feedCycles(delta(41), 7_800)).toBeNull();
    expect(useCycles.getState().model?.tick).toBe(41);
  });

  it('ignores deltas that come before any full without asking for anything', () => {
    expect(feedCycles(delta(6), 0)).toBeNull();
    expect(useCycles.getState().model).toBeNull();
  });

  it('forgets the round when the room goes back to the lobby or to the results', () => {
    for (const phase of ['lobby', 'results'] as const) {
      feedCycles(full(5), 0);
      followPhase('countdown');
      followPhase('running');
      expect(useCycles.getState().model).not.toBeNull();

      followPhase(phase);

      expect(useCycles.getState().model).toBeNull();
      expect(useCycles.getState().timeline).toBeNull();
    }
  });

  it('lists who cut off whom, the last four', () => {
    feedCycles(full(5), 0);
    for (let t = 6; t <= 11; t += 1) {
      feedCycles(
        {
          ...delta(t),
          events: [{ type: 'died', slot: t, by: t % 2 === 0 ? null : 1 }],
        },
        t * 125,
      );
    }

    const feed = useCycles.getState().feed;
    expect(feed.map((line) => [line.victim, line.killer])).toEqual([
      [8, null],
      [9, 1],
      [10, null],
      [11, 1],
    ]);
    expect(new Set(feed.map((line) => line.seq)).size).toBe(4);

    // Another round starts again from tick 0.
    feedCycles(full(0), 5_000);
    expect(useCycles.getState().feed).toEqual([]);
  });

  it('tells a listener what happened in a tick once the round holds that tick', () => {
    feedCycles(full(5), 0);
    const heard: Array<{ tick: number | undefined; types: string[] }> = [];
    const stop = onRoundEvents((events) => {
      heard.push({
        tick: useCycles.getState().model?.tick,
        types: events.map((event) => event.type),
      });
    });

    feedCycles({ ...delta(6), events: [{ type: 'boost', slot: 1 }] }, 125);
    feedCycles(delta(7), 250);
    feedCycles({ ...delta(8), events: [{ type: 'died', slot: 1, by: null }] }, 375);
    // Old news is not news: the same tick again, and a tick the listener has already had.
    feedCycles({ ...delta(8), events: [{ type: 'died', slot: 1, by: null }] }, 380);
    stop();
    feedCycles({ ...delta(9), events: [{ type: 'boost', slot: 1 }] }, 500);

    expect(heard).toEqual([
      { tick: 6, types: ['boost'] },
      { tick: 8, types: ['died'] },
    ]);
  });

  it('does not place a tick it has already seen on the timeline twice', () => {
    feedCycles(full(5), 0);
    feedCycles(delta(6), 125);
    feedCycles(delta(6), 130);

    const released = useCycles.getState().timeline?.release(1_000) ?? [];
    expect(released.map((step) => step.tick)).toEqual([5, 6]);
  });
});

describe('a full in the middle of the round', () => {
  beforeEach(clearCycles);

  /** The bike rides one cell a tick; the head of tick t is at cell 12 + (t - 5). */
  const trailTo = (tick: number): number[] =>
    Array.from({ length: tick - 3 }, (_, index) => 11 + index);

  /** Deltas of ticks 6 to `until`, one every 125 ms, a bike cut off at tick 7. */
  function ride(until: number): void {
    feedCycles(full(5), 0);
    for (let t = 6; t <= until; t += 1) {
      const events = t === 7 ? [{ type: 'died' as const, slot: 2, by: 1 }] : [];
      feedCycles({ ...delta(t), events }, (t - 5) * 125);
    }
  }

  it('keeps the kill feed, which the same round still has to show', () => {
    ride(30);
    const before = useCycles.getState().feed;
    expect(before).toHaveLength(1);

    // A bike joined: everyone is sent the round again, the same round.
    feedCycles(full(30, trailTo(30)), 25 * 125 + 5);

    expect(useCycles.getState().feed).toEqual(before);
    expect(useCycles.getState().model?.tick).toBe(30);
  });

  it('lays the whole field again from it, whatever was laid before', () => {
    ride(30);
    useCycles.getState().timeline?.release(1_000_000, 1);

    feedCycles(full(30, trailTo(30)), 25 * 125 + 5);

    const [again] = useCycles.getState().timeline?.release(1_000_000, 1) ?? [];
    expect(again?.reset).toBe(true);
    expect(again?.tick).toBe(30);
    expect(again?.walls.length).toBe(trailTo(30).length);
  });

  it('keeps the clock: the bike goes on riding between two ticks across it', () => {
    const held: number[] = [];
    let next = 6;
    feedCycles(full(5), 0);
    // Frames every 16 ms; the full of tick 30 is sent right after the delta of tick 30.
    for (let now = 0; now < 8_000; now += 16) {
      while (next <= 60 && (next - 5) * 125 <= now) {
        feedCycles(delta(next), (next - 5) * 125);
        if (next === 30) feedCycles(full(30, trailTo(30)), (next - 5) * 125 + 2);
        next += 1;
      }
      const timeline = useCycles.getState().timeline;
      timeline?.release(now, 1);
      const sample = timeline?.sample(now);
      // Until the last delta is in: after it the bike is rightly held on the newest head.
      if (sample === null || sample === undefined || now < 2_000) continue;
      if (sample.from.get(1)?.cell === sample.to.get(1)?.cell && now < (60 - 5) * 125)
        held.push(now);
    }

    expect(held).toEqual([]);
  });

  it.each([
    ['of another size', { side: 12 }],
    ['at another speed', { tickMs: 83 }],
  ])('starts over for a round %s', (_, over) => {
    ride(30);
    const timeline = useCycles.getState().timeline;

    feedCycles(full(30, trailTo(30), over), 3_000);

    expect(useCycles.getState().feed).toEqual([]);
    expect(useCycles.getState().timeline).not.toBe(timeline);
  });

  it('starts over for a round that began again from an earlier tick', () => {
    ride(30);

    feedCycles(full(0), 6_000);

    expect(useCycles.getState().feed).toEqual([]);
    expect(useCycles.getState().model?.tick).toBe(0);
  });
});
