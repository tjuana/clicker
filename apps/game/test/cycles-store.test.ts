import { type DeltaMessage, type FullMessage, PROTOCOL_VERSION } from '@clicker/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { seenOnScreen, turnSent, useLatencyView } from '../src/client/cycles/latency-store';
import {
  clearCycles,
  feedCycles,
  followPhase,
  onRoundEvents,
  RESYNC_RETRY_MS,
  useCycles,
} from '../src/client/cycles/store';
import { useClient } from '../src/client/store';

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
      energy: 80,
      cap: 80,
      lit: true,
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
  heads: [1, 12 + (t - 5), 0, 3, 0, 80, 80, 1],
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

describe('timing a turn on its way in', () => {
  /** Tick t with the bike pointing `dir`, or with no bike at all. */
  const facing = (t: number, dir: number | null): DeltaMessage => ({
    ...delta(t),
    heads: dir === null ? [] : [1, 12 + (t - 5), dir, 3, 0],
  });

  beforeEach(() => {
    clearCycles();
    useClient.setState({ you: '1' });
  });

  it('measures a turn up to the arrival of the first message that has the bike turned', () => {
    feedCycles(full(5), 0);
    feedCycles(facing(6, 0), 125);
    turnSent('right', 140);

    feedCycles(facing(7, 0), 250);
    expect(useLatencyView.getState().readout.server).toBeNull();
    feedCycles(facing(8, 1), 380);

    expect(useLatencyView.getState().readout.server).toEqual({ last: 240, median: 240 });
    // The scene has drawn nothing: it is the one to say when the screen has the turn.
    expect(useLatencyView.getState().readout.screen).toBeNull();
  });

  it("does not take another rider's turn for the player's own", () => {
    feedCycles(full(5), 0);
    turnSent('right', 10);

    feedCycles(
      {
        ...delta(6),
        heads: [1, 13, 0, 3, 0, 80, 80, 1, 2, 40, 1, 3, 0, 80, 80, 1],
        cells: [13, 1, 40, 2],
      },
      130,
    );

    expect(useLatencyView.getState().readout.server).toBeNull();
  });

  it('forgets a turn that was waiting when the bike died', () => {
    feedCycles(full(5), 0);
    turnSent('right', 100);
    feedCycles({ ...facing(6, null), events: [{ type: 'died', slot: 1, by: null }] }, 130);

    // It comes back, and the next turn is what the change is read as.
    feedCycles(facing(7, 3), 1_900);
    feedCycles(facing(8, 3), 2_025);
    turnSent('right', 2_100);
    feedCycles(facing(9, 0), 2_225);

    expect(useLatencyView.getState().readout.server).toEqual({ last: 125, median: 125 });
  });

  it('starts over with the round', () => {
    feedCycles(full(5), 0);
    turnSent('right', 10);
    feedCycles(facing(6, 1), 130);
    expect(useLatencyView.getState().readout.server).not.toBeNull();

    clearCycles();

    expect(useLatencyView.getState().readout).toEqual({
      server: null,
      screen: null,
      overshoot: null,
    });
  });
});

describe('counting the cells a turn lands late', () => {
  beforeEach(() => {
    clearCycles();
    useClient.setState({ you: '1' });
  });

  /**
   * The field is ten cells across and the bike rides east along its second row: cell 12 is at
   * x 2.5, cell 13 at 3.5, cell 14 at 4.5, all at z 1.5. A turn south at cell 13 goes on to 23.
   */
  const east = (cell: number, t: number): DeltaMessage => ({
    ...delta(t),
    cells: [cell, 1],
    heads: [1, cell, 0, 3, 0, 80, 80, 1],
  });
  const southFrom = (cell: number, t: number): DeltaMessage => ({
    ...delta(t),
    cells: [cell, 1],
    heads: [1, cell, 1, 3, 0, 80, 80, 1],
  });
  const overshoot = () => useLatencyView.getState().readout.overshoot?.last;

  it('is the way from where the bike was drawn to the cell it rode from when it turned', () => {
    feedCycles(full(5), 0);
    feedCycles(east(13, 6), 125);
    // Drawn on its way to the middle of cell 13, which is where it turns, and pressed there.
    seenOnScreen(0, 130, 3.1, 1.5);
    turnSent('right', 140);

    feedCycles(southFrom(23, 7), 250);

    expect(overshoot()).toBeCloseTo(0.4, 9);
  });

  it('does not depend on how far the bike went in the new direction: a boost step is no different', () => {
    feedCycles(full(5), 0);
    feedCycles(east(13, 6), 125);
    seenOnScreen(0, 130, 3.1, 1.5);
    turnSent('right', 140);

    // Two cells south in the one tick, from cell 13 to 33: the corner is still cell 13.
    feedCycles(southFrom(33, 7), 250);

    expect(overshoot()).toBeCloseTo(0.4, 9);
  });

  it('counts from the cell it rode from, not the one before, when the way up to it was boosted', () => {
    feedCycles(full(5), 0);
    // Two cells east in a tick, from 12 to 14.
    feedCycles(east(14, 6), 125);
    seenOnScreen(0, 130, 4.1, 1.5);
    turnSent('right', 140);

    feedCycles(southFrom(24, 7), 250);

    expect(overshoot()).toBeCloseTo(0.4, 9);
  });

  it('gives the time but no cells when the change is first seen in a full, which has no step', () => {
    feedCycles(full(5), 0);
    seenOnScreen(0, 130, 2.9, 1.5);
    turnSent('right', 140);

    const [bike] = full(8).bikes;
    feedCycles({ ...full(8), bikes: [{ ...(bike as NonNullable<typeof bike>), dir: 1 }] }, 380);

    expect(useLatencyView.getState().readout.server?.last).toBe(240);
    expect(overshoot()).toBeUndefined();
  });
});
