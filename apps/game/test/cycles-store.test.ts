import { type DeltaMessage, type FullMessage, PROTOCOL_VERSION } from '@clicker/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { clearCycles, feedCycles, useCycles } from '../src/client/cycles/store';

const full = (tick: number): FullMessage => ({
  v: PROTOCOL_VERSION,
  type: 'full',
  tick,
  tickMs: 125,
  side: 10,
  bikes: [
    {
      slot: 1,
      id: '1',
      alive: true,
      dir: 0,
      trail: [11, 12],
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

  it('ignores deltas that come before any full without asking for anything', () => {
    expect(feedCycles(delta(6), 0)).toBeNull();
    expect(useCycles.getState().model).toBeNull();
  });

  it('does not place a tick it has already seen on the timeline twice', () => {
    feedCycles(full(5), 0);
    feedCycles(delta(6), 125);
    feedCycles(delta(6), 130);

    const released = useCycles.getState().timeline?.release(1_000) ?? [];
    expect(released.map((step) => step.tick)).toEqual([5, 6]);
  });
});
